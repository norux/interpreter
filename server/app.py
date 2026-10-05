from fastapi import FastAPI

from server.capture.transport import capture_router


def create_app() -> FastAPI:
    application = FastAPI(title="Interpreter companion", docs_url=None, redoc_url=None)
    application.include_router(capture_router())

    @application.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return application


app = create_app()
