from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import account, invoices, meter_actions

app = FastAPI(title="Monitex API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok"}


app.include_router(account.router, prefix="/api/account")
app.include_router(invoices.router, prefix="/api")
app.include_router(meter_actions.router, prefix="/api/account")
