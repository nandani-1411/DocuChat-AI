import os

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from rag import (process_file, ask_question, list_models, list_documents, delete_document,
                 SUPPORTED_EXTENSIONS, UPLOAD_FOLDER)

app = FastAPI(title="DocuChat Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs(UPLOAD_FOLDER, exist_ok=True)


@app.get("/")
def home():
    return {"message": "DocuChat backend is running"}


@app.get("/supported-formats")
def supported_formats():
    return {"formats": sorted(SUPPORTED_EXTENSIONS)}


@app.get("/models")
def models():
    return list_models()


@app.get("/documents")
def documents():
    return list_documents()


@app.delete("/documents/{name}")
def remove_document(name: str):
    delete_document(name)
    return {"deleted": name}


# ── Upload many files at once ─────────────────────────────────────────────────
@app.post("/upload")
async def upload_files(files: list[UploadFile] = File(...)):
    results = []
    for file in files:
        name = os.path.basename(file.filename or "file")
        ext = os.path.splitext(name)[1].lower()

        if ext not in SUPPORTED_EXTENSIONS:
            results.append({"filename": name, "status": "error",
                            "message": f"Unsupported type '{ext}'. Allowed: {', '.join(sorted(SUPPORTED_EXTENSIONS))}"})
            continue

        path = os.path.join(UPLOAD_FOLDER, name)
        try:
            with open(path, "wb") as f:
                f.write(await file.read())
        except Exception as e:
            results.append({"filename": name, "status": "error", "message": f"Could not save file: {e}"})
            continue

        try:
            chunks = await run_in_threadpool(process_file, path)  # runs in the background, chat stays free
            if chunks == 0:
                results.append({"filename": name, "status": "error",
                                "message": "No readable text found. If this is a scanned PDF, the vision model may be busy. Try again in a minute."})
            else:
                results.append({"filename": name, "status": "success", "chunks_indexed": chunks,
                                "message": f"Indexed {chunks} chunks"})
        except Exception as e:
            results.append({"filename": name, "status": "error", "message": f"Processing failed: {str(e)[:200]}"})

    ok = sum(1 for r in results if r["status"] == "success")
    return {"summary": {"total": len(results), "succeeded": ok, "failed": len(results) - ok}, "files": results}


# ── Chat ──────────────────────────────────────────────────────────────────────
class ChatRequest(BaseModel):
    question: str
    mode: str = "ask"
    style: str = ""
    length: str = "medium"
    provider: str = "groq"
    model: str = "openai/gpt-oss-120b"
    use_docs: bool = False
    history: list[dict] = []


@app.post("/chat")
def chat(request: ChatRequest):
    try:
        return ask_question(request.question, request.mode, request.style, request.length,
                            request.model, request.use_docs, request.history, request.provider)
    except Exception as e:
        if getattr(e, "status_code", None) == 429:
            raise HTTPException(status_code=429,
                                detail="This model is busy or its limit is reached. Wait a minute or choose another model.")
        print("Chat error:", repr(e))
        raise HTTPException(status_code=500, detail=f"Model error: {str(e)[:200]}")
