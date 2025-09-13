/* FILE_ID: SFB/domcheck v1.0.0 */
import { REQUIRED_IDS, QS } from "./ids.js";

export function verifyDOM(){
  const missing = [];
  for(const id of REQUIRED_IDS){
    if(!document.getElementById(id)) missing.push(id);
  }
  if(missing.length){
    console.error("[SFB] Missing DOM IDs:", missing);
    let box = document.createElement("div");
    box.style.cssText = "position:fixed;bottom:10px;left:10px;right:10px;background:#400;padding:10px;border:1px solid #f88;color:#fff;font:12px/1.3 monospace;z-index:99999;border-radius:8px";
    box.textContent = "Missing DOM IDs: " + missing.join(", ");
    document.body.appendChild(box);
    throw new Error("DOM verification failed.");
  }
  // minimal sanity checks
  QS.get("shipTpl");
}
