from fastapi import FastAPI
from services.db_client import supabase
from routers import bills
from fastapi.middleware.cors import CORSMiddleware


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins (good for development)
    allow_credentials=True,
    allow_methods=["*"],  # Allows POST, GET, OPTIONS, etc.
    allow_headers=["*"],
)

app.include_router(bills.router, prefix="/v1/bills", tags=["Bills"])


@app.get("/")
def read_root():
    return {"status": "active", "service": "Bill Splitter API"}

@app.get("/test-db")
def test_db_connection():
    # Attempt to fetch bills to verify connection
    response = supabase.table("bills").select("*").execute()
    return {"data": response.data}

if __name__ == "__main__":
    import uvicorn
    # Run directly from python logic if needed, but CLI is preferred
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)