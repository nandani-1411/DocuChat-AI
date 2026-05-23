import os
import pytesseract

from dotenv import load_dotenv
from PIL import Image

# ── LangChain Loaders ──────────────────────────────────────────────────────────
from langchain_community.document_loaders import (
    PyPDFLoader,           # .pdf
    UnstructuredWordDocumentLoader,  # .doc / .docx
    UnstructuredExcelLoader,         # .xls / .xlsx
    CSVLoader,                       # .csv
    UnstructuredPowerPointLoader,    # .ppt / .pptx
    TextLoader,                      # .txt
    UnstructuredHTMLLoader,          # .html
)

from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document

from langchain_mistralai import ChatMistralAI, MistralAIEmbeddings
from langchain_community.vectorstores import Chroma


# ── Env ────────────────────────────────────────────────────────────────────────
load_dotenv()


# ── Models ────────────────────────────────────────────────────────────────────
embedding_model = MistralAIEmbeddings(model="mistral-embed")

llm = ChatMistralAI(model="mistral-medium-3-5")


# ── Config ────────────────────────────────────────────────────────────────────
PERSIST_DIRECTORY = "chroma_db"

SUPPORTED_EXTENSIONS = {
    ".pdf",
    ".doc", ".docx",
    ".xls", ".xlsx",
    ".csv",
    ".ppt", ".pptx",
    ".txt",
    ".html", ".htm",
    ".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".webp",
}


# ── Loader Router ─────────────────────────────────────────────────────────────
def load_document(file_path: str) -> list[Document]:
    """
    Route the file to the correct LangChain loader based on extension.
    Images are handled via Tesseract OCR → plain Document.
    """
    ext = os.path.splitext(file_path)[1].lower()

    # ── PDF ──
    if ext == ".pdf":
        loader = PyPDFLoader(file_path)
        return loader.load()

    # ── Word ──
    if ext in (".doc", ".docx"):
        loader = UnstructuredWordDocumentLoader(file_path, mode="elements")
        return loader.load()

    # ── Excel ──
    if ext in (".xls", ".xlsx"):
        loader = UnstructuredExcelLoader(file_path, mode="elements")
        return loader.load()

    # ── CSV ──
    if ext == ".csv":
        loader = CSVLoader(file_path)
        return loader.load()

    # ── PowerPoint ──
    if ext in (".ppt", ".pptx"):
        loader = UnstructuredPowerPointLoader(file_path, mode="elements")
        return loader.load()

    # ── Plain text ──
    if ext == ".txt":
        loader = TextLoader(file_path, encoding="utf-8")
        return loader.load()

    # ── HTML ──
    if ext in (".html", ".htm"):
        loader = UnstructuredHTMLLoader(file_path)
        return loader.load()

    # ── Images → OCR ──
    if ext in (".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".webp"):
        image = Image.open(file_path)
        text = pytesseract.image_to_string(image)
        if not text.strip():
            text = "[No readable text found in image]"
        return [Document(
            page_content=text,
            metadata={"source": file_path, "type": "image_ocr"}
        )]

    raise ValueError(f"Unsupported file type: {ext}")


# ── Process & Embed ───────────────────────────────────────────────────────────
def process_file(file_path: str) -> int:
    """
    Load, chunk, and embed a single file.
    Returns the number of chunks stored.
    """
    documents = load_document(file_path)

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200,
    )
    chunks = splitter.split_documents(documents)

    if not chunks:
        return 0

    Chroma.from_documents(
        documents=chunks,
        embedding=embedding_model,
        persist_directory=PERSIST_DIRECTORY,
    )

    return len(chunks)


# ── Ask ───────────────────────────────────────────────────────────────────────
def ask_question(question: str) -> str:
    """
    Retrieve top-k chunks from ChromaDB and generate an answer with the LLM.
    """
    vectorstore = Chroma(
        persist_directory=PERSIST_DIRECTORY,
        embedding_function=embedding_model,
    )

    retriever = vectorstore.as_retriever(search_kwargs={"k": 5})
    retrieved_docs = retriever.invoke(question)

    if not retrieved_docs:
        return "I couldn't find any relevant information in the uploaded documents."

    context = "\n\n".join(doc.page_content for doc in retrieved_docs)

    prompt = f"""You are a helpful AI assistant.
Use the provided context to answer the user's question accurately.
If the context does not contain enough information, say so honestly.
If the user asks for a summary, provide a detailed summary from the context.

Context:
{context}

Question:
{question}

Answer:"""

    response = llm.invoke(prompt)
    return response.content