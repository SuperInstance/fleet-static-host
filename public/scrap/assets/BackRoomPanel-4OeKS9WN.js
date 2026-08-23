function l(t){var i,d;(i=document.getElementById("backroom-panel"))==null||i.remove(),(d=document.exitPointerLock)==null||d.call(document);const o=document.createElement("div");o.id="backroom-panel",o.style.cssText=`
    position: fixed; inset: 0; z-index: 200; display: flex;
    align-items: center; justify-content: center;
    background: rgba(8, 6, 3, 0.75); font-family: 'Courier New', monospace;`,o.innerHTML=`
    <div style="
        width: min(640px, 92vw); max-height: 84vh; overflow-y: auto;
        background: #17120a; border: 2px solid #6b5a33; border-radius: 10px;
        color: #e8dcc0; padding: 20px 24px; font-size: 13px; line-height: 1.55;">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <h2 style="margin:0;font-size:18px;letter-spacing:2px;color:#ffd97a">☕ EARL'S BACK ROOM</h2>
        <span>
          <span id="br-marks" style="color:#ffd97a;margin-right:12px"></span>
          <button id="br-close" style="font:inherit;font-size:11px;background:#2a2214;color:#e8dcc0;border:1px solid #6b5a33;border-radius:4px;padding:3px 10px;cursor:pointer">close [Esc]</button>
        </span>
      </div>
      <div id="br-earl" style="margin:10px 0;font-style:italic;color:#c9b98a"></div>
      <div id="br-body"></div>
    </div>`,document.body.appendChild(o);const n=()=>{o.querySelector("#br-marks").textContent=`🏅 ${t.marks} mark${t.marks===1?"":"s"}`;const a=t.earlBoardLines??[];o.querySelector("#br-earl").textContent=`"${a[Math.floor(Math.random()*a.length)]??"Back room's open."}" — Earl`;const r=t.board();o.querySelector("#br-body").innerHTML=r.map(e=>`
      <div style="border-left:3px solid ${e.owned?"#8ef7c1":"#6b5a33"};padding:8px 12px;margin:8px 0;background:#100c06;display:flex;justify-content:space-between;gap:10px;align-items:center">
        <div>
          <b style="color:#ffd97a">${e.icon} ${e.label}</b>
          ${e.owned?'<span style="color:#8ef7c1"> ✓ yours</span>':""}
          <div style="opacity:.75;font-size:12px">${e.desc}</div>
          <div style="opacity:.55;font-size:11px;font-style:italic">"${e.earlLine}"</div>
        </div>
        <div style="white-space:nowrap">
          ${e.owned?"":`<button data-buy="${e.id}" ${e.affordable?"":"disabled"} style="font:inherit;font-size:11px;background:${e.affordable?"#2f4a2a":"#2a2214"};color:${e.affordable?"#8ef7c1":"#7a6f58"};border:1px solid #6b5a33;border-radius:4px;padding:4px 10px;cursor:${e.affordable?"pointer":"default"}">🏅 ${e.cost}</button>`}
        </div>
      </div>`).join(""),o.querySelectorAll("[data-buy]").forEach(e=>{e.addEventListener("click",()=>{t.purchase(e.dataset.buy),n()})})};n(),o.querySelector("#br-close").addEventListener("click",()=>o.remove()),o.addEventListener("keydown",a=>{a.code==="Escape"&&o.remove()}),o.tabIndex=0,o.focus()}export{l as openBackRoomPanel};
