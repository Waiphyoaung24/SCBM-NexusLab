from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks # <-- Added BackgroundTasks
from services.db_client import supabase
from services.ai_service import process_receipt_with_gemini # <-- Import the AI service
import uuid
from pydantic import BaseModel

router = APIRouter()
BUCKET_NAME = "receipts"

# Update function signature to include BackgroundTasks
@router.post("/upload")
async def upload_receipt(
    background_tasks: BackgroundTasks, # <-- Inject this
    file: UploadFile = File(...), 
    chat_id: str = None
):
    
    file_ext = file.filename.split(".")[-1]
    file_name = f"{uuid.uuid4()}.{file_ext}"
    
    try:
        file_content = await file.read()
        
        # Upload
        supabase.storage.from_(BUCKET_NAME).upload(
            path=file_name,
            file=file_content,
            file_options={"content-type": file.content_type}
        )
        
        public_url = supabase.storage.from_(BUCKET_NAME).get_public_url(file_name)

        # DB Record
        new_bill = {
            "external_id": chat_id,
            "status": "PROCESSING",
            "raw_image_url": public_url
        }
        
        data_response = supabase.table("bills").insert(new_bill).execute()
        created_bill = data_response.data[0]
        
        # --- TRIGGER AI IN BACKGROUND ---
        # This runs AFTER the return statement, so the user doesn't wait
        background_tasks.add_task(
            process_receipt_with_gemini, 
            bill_id=created_bill["id"], 
            image_url=public_url
        )
        
        return {
            "status": "success", 
            "bill_id": created_bill["id"],
            "message": "Receipt uploaded. AI is processing in the background."
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
class ClaimRequest(BaseModel):
    item_id: str
    user_id: str
    user_name: str

# 2. Add this Endpoint
@router.post("/{bill_id}/claim")
async def claim_item(bill_id: str, claim: ClaimRequest):
    """
    Smart Claiming:
    1. Toggle the user's claim (Join/Leave).
    2. Recalculate the split percentage for ALL users on this item.
    """
    try:
        # A. Check if user currently has a claim
        user_claim = supabase.table("claims").select("*")\
            .eq("item_id", claim.item_id)\
            .eq("user_id", claim.user_id)\
            .execute()

        # B. Toggle Logic
        if user_claim.data:
            # User is LEAVING -> Delete their claim
            supabase.table("claims").delete().eq("id", user_claim.data[0]['id']).execute()
        else:
            # User is JOINING -> Add a temp claim (percentage 0 for now)
            new_claim = {
                "item_id": claim.item_id,
                "user_id": claim.user_id,
                "user_name": claim.user_name,
                "percentage": 0 
            }
            supabase.table("claims").insert(new_claim).execute()

        # C. Re-Balance Logic (The "Fair Share" Math)
        # 1. Get all active claims for this item
        all_claims = supabase.table("claims").select("*").eq("item_id", claim.item_id).execute()
        claimants = all_claims.data
        count = len(claimants)

        if count > 0:
            # 2. Calculate new split (e.g., 1/3 = 0.3333)
            new_percentage = 1.0 / count
            
            # 3. Update EVERYONE'S percentage in DB
            # Note: In a real app, do this in a Transaction or Batch update
            for c in claimants:
                supabase.table("claims").update({"percentage": new_percentage})\
                    .eq("id", c['id']).execute()

        return {"status": "updated", "new_count": count}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))