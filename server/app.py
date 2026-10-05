from fastapi import FastAPI

app = FastAPI(title="Interpreter companion", docs_url=None, redoc_url=None)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
