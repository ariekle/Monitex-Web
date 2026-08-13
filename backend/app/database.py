"""
DB connection setup.

Points at whatever SQL Server the env vars describe — during development that's
the local Docker/Azure SQL Edge container restored from the Monitex .bak backup.

Configure via a .env file (see .env.example) or real env vars:
    DB_SERVER=localhost,1433
    DB_NAME=taxidb
    DB_USER=sa
    DB_PASSWORD=...
    DB_DRIVER=ODBC Driver 18 for SQL Server
"""
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

DB_SERVER = os.getenv("DB_SERVER", "localhost,1433")
DB_NAME = os.getenv("DB_NAME", "taxidb")
DB_USER = os.getenv("DB_USER", "sa")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_DRIVER = os.getenv("DB_DRIVER", "ODBC Driver 18 for SQL Server")

# TrustServerCertificate=yes because the local dev container uses a self-signed cert.
CONNECTION_STRING = (
    f"mssql+pyodbc://{DB_USER}:{DB_PASSWORD}@{DB_SERVER}/{DB_NAME}"
    f"?driver={DB_DRIVER.replace(' ', '+')}&TrustServerCertificate=yes"
)

engine = create_engine(CONNECTION_STRING, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """FastAPI dependency — yields a session, closes it after the request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
