"""Downloads section — generated PDFs saved per-user with share / rename / delete."""
import base64
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel


class RenameIn(BaseModel):
    name: str


def build_downloads_router(db, get_current_user, get_user_flex):
    router = APIRouter(prefix="/downloads")

    @router.get("")
    async def list_downloads(user=Depends(get_current_user)):
        items = await db.downloads.find(
            {"user_id": user["id"]}, {"_id": 0, "pdf_b64": 0}
        ).sort("created_at", -1).to_list(200)
        return {"items": items}

    @router.patch("/{did}")
    async def rename_download(did: str, body: RenameIn, user=Depends(get_current_user)):
        name = body.name.strip()
        if not name:
            raise HTTPException(400, "Name cannot be empty")
        r = await db.downloads.update_one({"id": did, "user_id": user["id"]}, {"$set": {"name": name[:120]}})
        if r.matched_count == 0:
            raise HTTPException(404, "Not found")
        return {"ok": True, "name": name[:120]}

    @router.delete("/{did}")
    async def delete_download(did: str, user=Depends(get_current_user)):
        r = await db.downloads.delete_one({"id": did, "user_id": user["id"]})
        if r.deleted_count == 0:
            raise HTTPException(404, "Not found")
        return {"ok": True}

    @router.get("/{did}/file")
    async def download_file(did: str, user=Depends(get_user_flex)):
        rec = await db.downloads.find_one({"id": did, "user_id": user["id"]}, {"_id": 0})
        if not rec:
            raise HTTPException(404, "Not found")
        pdf_bytes = base64.b64decode(rec.get("pdf_b64", ""))
        safe_name = "".join(ch for ch in rec.get("name", "download") if ch.isalnum() or ch in " ._-")[:80] or "download"
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}.pdf"'},
        )

    return router
