import os

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from rag import process_file, ask_question, SUPPORTED_EXTENSIONS


# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="Multi-File RAG Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Upload Folder ─────────────────────────────────────────────────────────────
UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
def home():
    return {"message": "Multi-File RAG Backend Running"}


@app.get("/supported-formats")
def supported_formats():
    return {"formats": sorted(SUPPORTED_EXTENSIONS)}


# ── Upload multiple files at once ─────────────────────────────────────────────
@app.post("/upload")
async def upload_files(files: list[UploadFile] = File(...)):
    """
    Accept one or more files in a single request.
    Supported: PDF, DOC, DOCX, XLS, XLSX, CSV, PPT, PPTX, TXT, HTML, PNG, JPG, JPEG, TIFF, BMP, WEBP
    """
    results = []

    for file in files:
        ext = os.path.splitext(file.filename)[1].lower()

        # ── Validate extension ──
        if ext not in SUPPORTED_EXTENSIONS:
            results.append({
                "filename": file.filename,
                "status": "error",
                "message": f"Unsupported file type '{ext}'. Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
            })
            continue

        # ── Save to disk ──
        file_path = os.path.join(UPLOAD_FOLDER, file.filename)
        try:
            content = await file.read()
            with open(file_path, "wb") as f:
                f.write(content)
        except Exception as e:
            results.append({
                "filename": file.filename,
                "status": "error",
                "message": f"Failed to save file: {str(e)}",
            })
            continue

        # ── Process & embed ──
        try:
            chunks = process_file(file_path)
            results.append({
                "filename": file.filename,
                "status": "success",
                "chunks_indexed": chunks,
                "message": f"Indexed {chunks} chunks successfully",
            })
        except Exception as e:
            results.append({
                "filename": file.filename,
                "status": "error",
                "message": f"Processing failed: {str(e)}",
            })

    # ── Summary ──
    success_count = sum(1 for r in results if r["status"] == "success")
    error_count = len(results) - success_count

    return {
        "summary": {
            "total": len(results),
            "succeeded": success_count,
            "failed": error_count,
        },
        "files": results,
    }


# ── Chat ──────────────────────────────────────────────────────────────────────
class ChatRequest(BaseModel):
    question: str


@app.post("/chat")
def chat(request: ChatRequest):
    if not request.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    answer = ask_question(request.question)
    return {"answer": answer}