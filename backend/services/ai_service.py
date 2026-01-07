import os
import json
import requests
from typing import List
from io import BytesIO
from PIL import Image
from pydantic import BaseModel

from google import genai
from services.db_client import supabase


# -----------------------------
# Gemini Client
# -----------------------------
client = genai.Client(api_key=os.environ.get("GOOGLE_API_KEY"))


# -----------------------------
# Schemas
# -----------------------------
class ReceiptItem(BaseModel):
    name: str
    quantity: int
    price: float
    category: str  # FOOD, ALCOHOL, SHARED, TAX, TIP


class ReceiptData(BaseModel):
    items: List[ReceiptItem]
    currency: str
    tax_amount: float
    tip_amount: float


# -----------------------------
# Main Processor
# -----------------------------
def process_receipt_with_gemini(bill_id: str, image_url: str):
    print(f"🤖 Starting AI processing for bill: {bill_id}")

    prompt = """
Analyze this receipt image. Extract all line items, tax, and tip.

Rules:
1. Output STRICT JSON only. No markdown.
2. ALWAYS translate item names to English.
3. Detect currency code (THB, USD, JPY, MMK).
4. Categories: FOOD, ALCOHOL, SHARED, TAX, TIP.
5. Price: return numeric value as-is.
6. Structure:
{
  "items": [{"name": "", "quantity": 1, "price": 100, "category": "FOOD"}],
  "currency": "THB",
  "tax_amount": 0,
  "tip_amount": 0
}
"""

    try:
        # -----------------------------
        # Load Image
        # -----------------------------
        response = requests.get(image_url, timeout=15)
        response.raise_for_status()
        image = Image.open(BytesIO(response.content))

        # -----------------------------
        # Gemini Call
        # -----------------------------
        ai_response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[prompt, image],
        )

        if not ai_response.text:
            raise ValueError("Empty AI response")

        raw_text = ai_response.text.replace("```json", "").replace("```", "").strip()
        data = json.loads(raw_text)

        receipt = ReceiptData(**data)

        # -----------------------------
        # Update Bill
        # -----------------------------
        supabase.table("bills").update({
            "status": "OPEN",
            "currency": receipt.currency,
            "tax_amount": receipt.tax_amount,
            "tip_amount": receipt.tip_amount,
        }).eq("id", bill_id).execute()

        # -----------------------------
        # Insert Items
        # -----------------------------
        items_to_insert = []
        for item in receipt.items:
            if item.category.upper() in {"TAX", "TIP"}:
                continue

            items_to_insert.append({
                "bill_id": bill_id,
                "name": item.name,
                "quantity": item.quantity or 1,
                "unit_price": item.price,
                "category": item.category.upper(),
            })

        if items_to_insert:
            supabase.table("items").insert(items_to_insert).execute()

        # -----------------------------
        # Notify via n8n
        # -----------------------------
        bill_row = (
            supabase.table("bills")
            .select("external_id")
            .eq("id", bill_id)
            .single()
            .execute()
        )

        chat_id = bill_row.data.get("external_id")

        if chat_id:
            n8n_webhook_url = "https://nexuslabdev.app.n8n.cloud/webhook/bill-ready"
            payload = {
                "bill_id": bill_id,
                "chat_id": chat_id,
                "currency": receipt.currency,
            }
            # Optional: Check if the request was actually successful
            resp = requests.post(n8n_webhook_url, json=payload, timeout=10)
            print(f"🚀 n8n notified for chat_id {chat_id} | Status: {resp.status_code}")

        else:
            print(f"⚠️ SKIPPING n8n: 'external_id' is missing/null for bill {bill_id}")

    except Exception as e:
        print(f"❌ AI Error: {e}")
        supabase.table("bills").update({"status": "ERROR"}).eq("id", bill_id).execute()
