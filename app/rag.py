import base64
import io
import os
import time

import httpx
from dotenv import load_dotenv

load_dotenv()  # must run before any model is created

from langchain_core.documents import Document
from langchain_core.messages import HumanMessage
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_groq import ChatGroq
from langchain_openai import ChatOpenAI
from langchain_community.document_loaders import PyPDFLoader, CSVLoader, TextLoader, UnstructuredHTMLLoader

try:
    from langchain_chroma import Chroma
except ImportError:
    from langchain_community.vectorstores import Chroma


# ── Config ────────────────────────────────────────────────────────────────────
# New folder name: the old "chroma_db" was made with Mistral (1024 numbers).
# The local model makes 384 numbers, so they cannot share one folder.
PERSIST_DIRECTORY = "chroma_db_local"
UPLOAD_FOLDER = "uploads"
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".webp"}
SUPPORTED_EXTENSIONS = {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".ppt", ".pptx", ".txt", ".html", ".htm"} | IMAGE_EXTS

embedding_model = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")


def _vs():
    return Chroma(persist_directory=PERSIST_DIRECTORY, embedding_function=embedding_model)


# ── Models (Groq + free OpenRouter) ───────────────────────────────────────────
_llms = {}


def get_llm(provider: str, model: str):
    key = (provider, model)
    if key not in _llms:
        if provider == "openrouter":
            _llms[key] = ChatOpenAI(model=model, api_key=os.getenv("OPENROUTER_API_KEY"),
                                    base_url="https://openrouter.ai/api/v1", temperature=0.3,
                                    timeout=45, max_retries=1)
        else:
            _llms[key] = ChatGroq(model=model, temperature=0.3, timeout=45, max_retries=1)
    return _llms[key]


_cache = {"time": 0, "ttl": 0, "data": None}


def list_models():
    """Live lists. Returns {"models": [...], "errors": {...}}. Errors are shown in the UI."""
    if _cache["data"] and time.time() - _cache["time"] < _cache["ttl"]:
        return _cache["data"]
    models, errors = [], {}
    try:
        from groq import Groq
        for m in Groq().models.list().data:
            if not any(x in m.id for x in ("whisper", "tts", "guard", "orpheus", "embed")):
                vision = any(x in m.id for x in ("scout", "maverick", "vision"))
                models.append({"provider": "groq", "id": m.id, "name": m.id.split("/")[-1], "vision": vision})
    except Exception as e:
        errors["groq"] = str(e)[:120]
    try:
        r = httpx.get("https://openrouter.ai/api/v1/models", timeout=20, follow_redirects=True)
        r.raise_for_status()
        n = 0
        for m in r.json()["data"]:
            p = m.get("pricing") or {}
            arch = m.get("architecture") or {}
            free = m["id"].endswith(":free") or (str(p.get("prompt")) == "0" and str(p.get("completion")) == "0")
            if free and "text" in (arch.get("output_modalities") or ["text"]) and n < 60:
                models.append({"provider": "openrouter", "id": m["id"], "name": m.get("name", m["id"]),
                               "vision": "image" in (arch.get("input_modalities") or [])})
                n += 1
    except Exception as e:
        errors["openrouter"] = str(e)[:120]
    data = {"models": models, "errors": errors}
    _cache.update(time=time.time(), ttl=60 if errors else 600, data=data)  # retry soon if something failed
    return data


# ── Images: a vision model reads them (no OCR program needed) ─────────────────
VISION_PROMPT = ("Look at this image. First write all visible text exactly as it appears. "
                 "Then describe what the image shows (objects, charts, tables, people, scene) in a few clear sentences. "
                 "Use plain text.")


def _image_b64(path: str) -> str:
    from PIL import Image
    img = Image.open(path).convert("RGB")
    img.thumbnail((1600, 1600))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _vision_models():
    out = []
    env = os.getenv("VISION_MODEL")  # optional, example: groq:meta-llama/llama-4-scout-17b-16e-instruct
    if env and ":" in env:
        p, m = env.split(":", 1)
        out.append((p, m))
    ms = [m for m in list_models()["models"] if m.get("vision")]
    out += [(m["provider"], m["id"]) for m in ms if m["provider"] == "groq"]
    out += [(m["provider"], m["id"]) for m in ms if m["provider"] == "openrouter"][:4]
    return out


def describe_image(path: str) -> str:
    content = [{"type": "text", "text": VISION_PROMPT},
               {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{_image_b64(path)}"}}]
    last = ""
    for provider, model in _vision_models():
        try:
            text = get_llm(provider, model).invoke([HumanMessage(content=content)]).content
            if text and text.strip():
                return text.strip()
        except Exception as e:
            last = str(e)[:100]
    raise RuntimeError(f"No vision model could read this image right now. Try again in a minute. ({last})")


# ── File readers ──────────────────────────────────────────────────────────────
def _doc(text, path, kind):
    return [Document(page_content=text, metadata={"source": path, "type": kind})]


# ── Pictures inside files (PDF, Word, PowerPoint) ─────────────────────────────
MAX_IMAGES = int(os.getenv("MAX_IMAGES_PER_FILE", "8"))  # limit per file, keeps uploads fast
MIN_SIDE = 120  # skip tiny pictures such as icons, lines and logos


def _describe_one(data: bytes):
    """Ask the vision model about one picture. Never stops the upload if it fails."""
    try:
        from PIL import Image
        if min(Image.open(io.BytesIO(data)).size) < MIN_SIDE:
            return None
        return describe_image(io.BytesIO(data))
    except Exception as e:
        print("Picture skipped:", repr(e)[:120])
        return False  # False = the vision model failed (None = picture was just too small)


def _caption(data: bytes, counter: list):
    if counter[0] >= MAX_IMAGES or counter[1] >= 2:  # stop after 2 failures, do not keep waiting
        return None
    text = _describe_one(data)
    if text is False:
        counter[1] += 1
        return None
    if text:
        counter[0] += 1
    return text


def _read_pdf(path):
    docs = PyPDFLoader(path).load()  # normal text, one item per page
    try:
        from pypdf import PdfReader
        counter = [0, 0]  # [pictures read, pictures failed]
        for i, page in enumerate(PdfReader(path).pages):
            if counter[0] >= MAX_IMAGES or counter[1] >= 2:
                break
            extra = []
            for img in page.images:
                text = _caption(img.data, counter)
                if text:
                    extra.append(f"[Picture on page {i + 1}]\n{text}")
            if extra and i < len(docs):
                docs[i].page_content += "\n\n" + "\n\n".join(extra)
    except Exception as e:
        print("PDF pictures skipped:", repr(e)[:120])
    return docs


def _read_docx(path):
    from docx import Document as Word
    d = Word(path)
    parts = [p.text for p in d.paragraphs if p.text.strip()]
    for table in d.tables:
        for row in table.rows:
            parts.append(" | ".join(c.text.strip() for c in row.cells))
    counter = [0, 0]
    for rel in d.part.rels.values():
        if "image" in rel.reltype:
            text = _caption(rel.target_part.blob, counter)
            if text:
                parts.append(f"[Picture in document]\n{text}")
    return _doc("\n".join(parts), path, "docx")


def _read_pptx(path):
    from pptx import Presentation
    from pptx.enum.shapes import MSO_SHAPE_TYPE
    parts, counter = [], [0, 0]
    for i, slide in enumerate(Presentation(path).slides, 1):
        parts.append(f"--- Slide {i} ---")
        for shape in slide.shapes:
            if shape.has_text_frame and shape.text_frame.text.strip():
                parts.append(shape.text_frame.text)
            if shape.shape_type == MSO_SHAPE_TYPE.PICTURE:
                text = _caption(shape.image.blob, counter)
                if text:
                    parts.append(f"[Picture on slide {i}]\n{text}")
    return _doc("\n".join(parts), path, "pptx")


def _read_xlsx(path):
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    parts = []
    for ws in wb.worksheets:
        parts.append(f"--- Sheet: {ws.title} ---")
        for row in ws.iter_rows(values_only=True):
            if any(c is not None for c in row):
                parts.append(" | ".join("" if c is None else str(c) for c in row))
    return _doc("\n".join(parts), path, "xlsx")


def _read_legacy(path, ext):
    try:
        from langchain_community.document_loaders import (
            UnstructuredWordDocumentLoader, UnstructuredExcelLoader, UnstructuredPowerPointLoader)
    except ImportError:
        raise RuntimeError(f"'{ext}' is an old format. Save it as .docx / .xlsx / .pptx and upload again.")
    loader = {".doc": UnstructuredWordDocumentLoader, ".xls": UnstructuredExcelLoader, ".ppt": UnstructuredPowerPointLoader}[ext]
    return loader(path, mode="elements").load()


def load_document(path: str):
    ext = os.path.splitext(path)[1].lower()
    if ext == ".pdf":
        return _read_pdf(path)
    if ext == ".docx":
        return _read_docx(path)
    if ext == ".pptx":
        return _read_pptx(path)
    if ext == ".xlsx":
        return _read_xlsx(path)
    if ext in (".doc", ".xls", ".ppt"):
        return _read_legacy(path, ext)
    if ext == ".csv":
        return CSVLoader(path).load()
    if ext == ".txt":
        return TextLoader(path, encoding="utf-8").load()
    if ext in (".html", ".htm"):
        return UnstructuredHTMLLoader(path).load()
    if ext in IMAGE_EXTS:
        return _doc(describe_image(path), path, "image")
    raise ValueError(f"Unsupported file type: {ext}")


# ── Save / list / delete documents ────────────────────────────────────────────
def _remove_chunks(path: str):
    try:
        _vs()._collection.delete(where={"source": path})
    except Exception:
        pass


def process_file(path: str) -> int:
    documents = load_document(path)
    chunks = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200).split_documents(documents)
    chunks = [c for c in chunks if c.page_content.strip()]
    if not chunks:
        return 0
    _remove_chunks(path)  # uploading the same file again will not make duplicates
    Chroma.from_documents(documents=chunks, embedding=embedding_model, persist_directory=PERSIST_DIRECTORY)
    return len(chunks)


def list_documents():
    try:
        metas = _vs()._collection.get(include=["metadatas"])["metadatas"]
    except Exception:
        return []
    names = sorted({os.path.basename(m["source"]) for m in metas if m and m.get("source")})
    return [{"filename": n, "status": "success", "note": "Indexed"} for n in names]


def delete_document(name: str):
    path = os.path.join(UPLOAD_FOLDER, os.path.basename(name))
    _remove_chunks(path)
    if os.path.exists(path):
        os.remove(path)


# ── Ask ───────────────────────────────────────────────────────────────────────
MODE_HELP = {
    "ask": "Answer the question.",
    "summarize": "Summarize the content.",
    "facts": "Extract the key facts.",
    "explain": "Explain the content clearly.",
    "review": "Review the content and give feedback.",
}
LENGTH_HELP = {"small": "Keep the answer under 100 words.", "medium": "Use about 200 words.", "high": "Be detailed and thorough."}


def ask_question(question, mode="ask", style="", length="medium",
                 model="openai/gpt-oss-120b", use_docs=False, history=None, provider="groq"):
    llm = get_llm(provider, model)

    context, sources = "", []
    if use_docs:
        docs = _vs().as_retriever(search_kwargs={"k": 6}).invoke(question)
        context = "\n\n".join(d.page_content for d in docs)
        for d in docs:
            label = os.path.basename(d.metadata.get("source", ""))
            if "page" in d.metadata:
                label += f" p.{int(d.metadata['page']) + 1}"
            if label and label not in sources:
                sources.append(label)

    chat_history = "\n".join(f"{h['role']}: {h['content']}" for h in (history or [])[-8:])

    prompt = f"""You are DocuChat, a friendly assistant.

Rules:
- If the user says hello, makes small talk, or asks a general question, answer normally and kindly.
- If a Context is given and the question is about it, answer only from the Context. If it is not enough, say so honestly.
- If there is no Context, just chat normally.

Task: {MODE_HELP.get(mode, MODE_HELP["ask"])} (only when the question is about the documents)
Style: {style}
{LENGTH_HELP.get(length, LENGTH_HELP["medium"])}
Write in Markdown: short headings, bullet lists, and **bold** for key words.

Chat so far:
{chat_history}

Context:
{context or "(no documents)"}

User: {question}
Assistant:"""
    answer = llm.invoke(prompt).content
    return {"answer": answer, "sources": sources if context else []}
