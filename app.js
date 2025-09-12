/*==========================================================
  Space Fleet Battle — Sectioned App (single global API)
  Public namespaces: App.util, App.state, App.render, App.flow, App.ai, App.tests, App.dom
  Replace whole sections between the fences safely.
==========================================================*/

/*========[ SECTION: CONSTANTS ]========*/
const SUITS = ["C","H","D","S"];
const RANKS = [1,2,3,4,5,6,7,8,9,10,11,12,13]; // A=1
/*========[ /SECTION ]========*/


/*========[ SECTION: UTILITIES (public) ]========*/
const App = window.App || (window.App = {});

App.util = {
  deep: (o)=>JSON.parse(JSON.stringify(o)),
  sum: (arr)=>arr.reduce((a,b)=>a+b,0),
  lbl(c){ return c.suit==="JOKER" ? "Joker" :
    ({1:"A",11:"J",12:"Q",13:"K"}[c.rank]||c.rank)+({C:"♣",H:"♥",D:"♦",S:"♠"}[c.suit]); },
  $(id){ return document.getElementById(id); },
  assert(cond, msg){ if(!cond) throw new Error("Assert: "+msg); },
  makeDeck(){
    const deck = [];
    for(const s of SUITS) for(const r of RANKS) deck.push({suit:s, rank:r});
    deck.push({suit:"JOKER",rank:0}); deck.push({suit:"JOKER",rank:0});
    for(let i=deck.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [deck[i],deck[j]]=[deck[j],deck[i]]; }
    return deck;
  },
};
/*========[ /SECTION ]========*/


/*========[ SECTION: DOM (public) ]========*/
App.dom = {
  ids: [
    "controlsCol","board","hand","log","turnPill","deckCount","handCount",
    "actionHint","selectedInfo","btnBuild","btnAttack","btnCrown","btnUndo",
    "btnEndTurn","btnNewGame","btnConfirmLaunch","aiToggle","aiDifficulty","onceNote"
  ],
  get(id){ const el = App.util.$(id); if(!el) console.warn("[DOM] Missing #"+id); return el; }
};
/*========[ /SECTION ]========*/


/*========[ SECTION: GAME STATE (public) ]========*/
App.state = {
  deck: [],
  players: [
    { id:0, name:"Player 1", color:"p1", hand:[], ships:[], drewTwo:false },
    { id:1, name:"Player 2", color:"p2", hand:[], ships:[], drewTwo:false },
  ],
  turn: 0,
  log: [],
  // Phases: idle | build_pick | build_target | launch_pair | attack_select_attacker | attack_select_target | crown_select_ship | special_target
  phase: "idle",
  pending: null,
  history: [],
  turnActionUsed: false,
  maxFleet: 3
};
/*========[ /SECTION ]========*/


/*========[ SECTION: CORE HELPERS (pure) ]========*/
(function(Core){
  const S = App.state, U = App.util;

  // Stacking: base = max value in suit; each additional card of same suit = +1
  function suitTotal(arr){
    if(!arr || arr.length===0) return 0;
    let max = 0;
    for (const v of arr) if (v > max) max = v;
    return max + (arr.length - 1);
  }

  function ensureSuitArrays(ship){
    ship._clubs    = ship._clubs    || (ship.engine>0        ? [ship.engine] : []);
    ship._hearts   = ship._hearts   || (ship.hull>0          ? [ship.hull]   : []);
    ship._diamonds = ship._diamonds || (ship.shieldRating>0  ? [ship.shieldRating] : []);
    ship._spades   = ship._spades   || (Array.isArray(ship.weapons) ? [...ship.weapons] : []);
    return ship;
  }

  // Recompute effective stats from suit arrays
  function recomputeStats(ship){
    ensureSuitArrays(ship);
    ship.engine       = suitTotal(ship._clubs);

    // Hull: treat as a pool that increases when the stacked total increases
    const prev = ship.hull;
    const target = suitTotal(ship._hearts);
    if (target > prev) ship.hull += (target - prev);

    ship.shieldRating = suitTotal(ship._diamonds);
    ship.weapons      = [...ship._spades];
    return ship;
  }

  Core.guaranteeAce = function(hand, deck){
    if(!hand.some(c=>c.rank===1)){
      const idx = deck.findIndex(c=>c.rank===1 && c.suit!=="JOKER");
      if(idx>=0){ hand.push(deck.splice(idx,1)[0]); }
    }
  };

  Core.roleOf = function(ship){
    ensureSuitArrays(ship);
    const E=ship.engine, H=ship.hull;
    if(ship.weapons.length===0 || E===H) return "Support";
    if(E>H) return "Speed";
    return "Tank";
  };

  Core.usableWeapons = function(ship){
    ensureSuitArrays(ship);
    if(ship.weaponsInactiveTurns>0) return [];
    return ship.weapons.filter(v=>v<=ship.engine);
  };

  Core.shipDamage = function(ship){
    ensureSuitArrays(ship);
    const w = Core.usableWeapons(ship);
    if(w.length===0) return Core.roleOf(ship)==="Speed" ? 2 : 0;
    const base  = Math.max(...w);
    const stack = w.length-1;
    let dmg = base + stack;
    if(Core.roleOf(ship)==="Speed") dmg += 2;
    return Math.max(0,dmg);
  };

  Core.applyDamage = function(target, amount, {bypassShields=false}={}){
    if(!target || !target.alive) return 0;
    ensureSuitArrays(target);
    let dealt = 0;
    if(!bypassShields && target.shieldActive && target.shieldRating>0 && amount>0){
      const absorbed = Math.min(amount, target.shieldRating);
      amount -= absorbed; dealt += absorbed;
      target.shieldActive = false;
      target.shieldCooldown = 1; // 1 owner-turn cooldown
      const el = document.querySelector(`[data-sid="${target.id}"] .shieldArc`);
      if(el){ el.classList.remove('ping'); void el.offsetWidth; el.classList.add('ping'); }
    }
    if(amount>0){
      target.hull -= amount;
      dealt += amount;
      if(target.hull<=0){ target.hull=0; target.alive=false; }
    }
    return dealt;
  };

  Core.totalHP = (p)=> U.sum(p.ships.filter(s=>s.alive).map(s=> s.hull + (s.shieldActive ? s.shieldRating : 0)));
  Core.flagshipDestroyed = (p)=> p.ships.some(s=>s.flagship) && !p.ships.some(s=>s.flagship && s.alive);

  Core.weakestEnemyShip = function(pid){
    const opp = S.players[1-pid];
    const alive = opp.ships.filter(s=>s.alive);
    alive.sort((a,b)=>(a.hull+(a.shieldActive?a.shieldRating:0))-(b.hull+(b.shieldActive?b.shieldRating:0)) || a.engine-b.engine);
    return alive[0] || null;
  };

  Core.startOfOwnerTurnMaintenance = function(p){
    for(const s0 of p.ships){
      const s = ensureSuitArrays(s0);
      if(s.alive && s.shieldCooldown>0){ s.shieldCooldown -= 1; if(s.shieldCooldown===0) s.shieldActive = true; }
      if(s.alive && s.weaponsInactiveTurns>0){ s.weaponsInactiveTurns -= 1; }
      recomputeStats(s);
    }
  };

  Core.canApplyCardToShip = function(card, ship, ownerId){
    ensureSuitArrays(ship);
    if(!ship.alive) return false;
    if(ownerId!==App.state.turn) return false; // own ships only during your turn
    if(card.suit==="C" || card.suit==="H" || card.suit==="D") return true;
    if(card.suit==="S" && card.rank>=2 && card.rank<=10) return card.rank <= ship.engine;
    return false;
  };

  Core.eligibleBuildTargets = (player, card)=> player.ships.filter(s=> Core.canApplyCardToShip(card, s, player.id) );

  Core.ensureSuitArrays = ensureSuitArrays;
  Core.recomputeStats   = recomputeStats;
  Core.suitTotal        = suitTotal;

})(App.core = App.core || {});
/*========[ /SECTION ]========*/


/*========[ SECTION: RENDER (public, read-only) ]========*/
App.render = (function(){
  const S = App.state, U = App.util, C = App.core, D = App.dom;

  function setHint(t){ const el=D.get("actionHint"); if(el) el.textContent=t; }
  function setSelected(t){ const el=D.get("selectedInfo"); if(el) el.textContent=t||"—"; }

  function renderLog(){
    const el=D.get("log"); if(!el) return;
    el.innerHTML = S.log.map(l=>`<div class="${l.cls||''}">${l.msg}</div>`).join("");
  }

  function log(msg, cls=""){ S.log.unshift({msg,cls,t:Date.now()}); renderLog(); }

  function computeShipHighlights(ownerId){
    const map = {};
    const phase = S.phase, pend=S.pending;

    if(phase==="build_target" && pend?.selectedIdx!=null && ownerId===S.turn){
      const card = S.players[S.turn].hand[pend.selectedIdx];
      if(card){
        for(const s of S.players[ownerId].ships){
          if(C.canApplyCardToShip(card, s, ownerId)) map[s.id]=true;
        }
      }
    }
    if(phase==="attack_select_attacker" && ownerId===S.turn){
      for(const s of S.players[ownerId].ships){ if(s.alive && C.shipDamage(s)>0) map[s.id]=true; }
    }
    if(phase==="attack_select_target" && ownerId===1-S.turn){
      for(const s of S.players[ownerId].ships){ if(s.alive) map[s.id]=true; }
    }
    if(phase==="crown_select_ship" && ownerId===S.turn){
      for(const s of S.players[ownerId].ships){ if(s.alive) map[s.id]=true; }
    }
    if(phase==="special_target" && pend?.card){
      for(const s of S.players[ownerId].ships){
        if(ownerId===S.turn && pend.card.rank===12 && pend.card.suit==="S"){ if(s.alive) map[s.id]=true; }
        if(ownerId===1-S.turn && (pend.card.suit==="JOKER" || (pend.card.suit==="S" && pend.card.rank!==12))){
          if(s.alive) map[s.id]=true;
        }
      }
    }
    return map;
  }

  function render(){
    const me = S.players[S.turn];
    const meColor = me.color;

    const col = D.get("controlsCol");
    if(col){
      col.classList.toggle("controls-p1", meColor==="p1");
      col.classList.toggle("controls-p2", meColor==="p2");
    }
    const tp = D.get("turnPill");
    if(tp) tp.innerHTML = `Turn: <span class="${meColor}">${me.name}</span>`;

    const handDiv = D.get("hand");
    if(handDiv){
      handDiv.classList.toggle("p1", meColor==="p1");
      handDiv.classList.toggle("p2", meColor==="p2");
      handDiv.innerHTML="";
    }
    const deckCount = D.get("deckCount"); if(deckCount) deckCount.textContent = S.deck.length;
    const handCount = D.get("handCount"); if(handCount) handCount.textContent = me.hand.length;

    const b = D.get("board"); if(b) b.innerHTML="";
    S.players.forEach(p=>{
      const side = document.createElement("div"); side.className="side";
      side.innerHTML = `<div><strong class="${p.color}">${p.name}</strong></div>`;
      const grid = document.createElement("div"); grid.className="ships";

      const highlightMap = computeShipHighlights(p.id);

      p.ships.forEach(s=>{
        const d = document.createElement("div"); d.className="ship"+(s.alive?"":" dead"); d.dataset.sid = s.id;
        if(highlightMap[s.id]) d.classList.add("hl");

        const role = C.roleOf(s);
        const dmg = C.shipDamage(s);
        const wlist = C.usableWeapons(s).sort((a,b)=>b-a);
        const shieldStr = s.shieldActive ? `Shield ${s.shieldRating}` : (s.shieldRating>0 ? `Shield ${s.shieldRating} (inactive)` : `No Shield`);
        const shieldClass = "shieldArc" + (s.shieldActive ? "" : " inactive");

        d.innerHTML = `
          ${s.flagship?`<div class="flag">Flagship</div>`:""}
          ${s.reflect?`<div class="reflect">Reflect</div>`:""}
          ${s.weaponsInactiveTurns>0?`<div class="jokered">Weapons Offline</div>`:""}
          <div class="shiphead"><h3>${s.name}</h3><span class="role">${role}</span></div>
          <div class="grid">
            <div class="hull">
              <span class="badge"><span class="icon">♥</span> ${s.hull}</span>
              <div class="shieldBox">
                <div class="${shieldClass}">${s.shieldRating?`<span class="icon">♦</span> ${shieldStr}`:`<span class="muted">No Shield</span>`}</div>
              </div>
            </div>
            <div class="engine"><span class="icon">♣</span> ${s.engine}</div>
            <div class="weapons">
              <div class="badge"><span class="icon">♠</span> ${wlist.length? wlist.join(", ") : "—"}</div>
            </div>
          </div>
          <div class="dmg"><div class="missile"></div> ${dmg}</div>
        `;
        d.addEventListener("click", ()=>{
          const phase = S.phase;
          if((phase==="build_target") && p.id===S.turn){ App.flow.applyBuildToShip(s.id); }
          else if(phase==="attack_select_attacker" && p.id===S.turn){ App.flow.selectAttacker(s.id); }
          else if(phase==="attack_select_target" && p.id===1-S.turn){ App.flow.performAttackOn(s.id); }
          else if(phase==="crown_select_ship" && p.id===S.turn){ App.flow.applyCrown(s.id); }
          else if(phase==="special_target"){ App.flow.applySpecialOn(s.id); }
          else setSelected(`Ship • ${s.name} — E:${s.engine} H:${s.hull} Sh:${s.shieldActive? s.shieldRating:0} | Role:${role} | Dmg:${dmg}`);
        });

        grid.appendChild(d);
      });

      side.appendChild(grid); if(b) b.appendChild(side);
    });

    // Hand
    const hand = D.get("hand");
    if(hand){
      const p = me;
      hand.innerHTML = "";
      p.hand.forEach((c,idx)=>{
        const el=document.createElement("div"); el.className="card "+({C:"c",H:"h",D:"d",S:"s"}[c.suit]||"");
        el.textContent=U.lbl(c);

        if(S.phase==="build_target" && S.pending?.selectedIdx===idx) el.classList.add("sel");
        if(S.phase==="special_target" || S.phase==="launch_pair") el.classList.add("disabled");

        el.addEventListener("click", ()=>{
          if(S.phase==="build_pick" || S.phase==="build_target"){ App.flow.handleBuildSelectCard(idx); }
          else { setSelected(`Card • ${U.lbl(c)}`); }
        });
        hand.appendChild(el);
      });
    }

    const used = S.turnActionUsed;
    const launching = (S.phase==="launch_pair");
    const cl = D.get("btnConfirmLaunch");
    if(cl) cl.style.display = launching ? "inline-block" : "none";

    const gate = !["idle","build_pick","build_target","launch_pair"].includes(S.phase);
    const btnBuild  = D.get("btnBuild");  if(btnBuild)  btnBuild.disabled  = used || gate;
    const btnAttack = D.get("btnAttack"); if(btnAttack) btnAttack.disabled = used || (S.phase!=="idle");
    const btnCrown  = D.get("btnCrown");  if(btnCrown)  btnCrown.disabled  = used || (S.phase!=="idle");
    const once = D.get("onceNote"); if(once) once.classList.toggle("used", used);

    const deckCount = D.get("deckCount"); if(deckCount) deckCount.textContent = S.deck.length;
    const handCount = D.get("handCount"); if(handCount) handCount.textContent = S.players[S.turn].hand.length;
  }

  return { render, renderLog, setHint, setSelected, log };
})();
const R = App.render;
/*========[ /SECTION ]========*/


/*========[ SECTION: FLOW / ACTIONS (public) ]========*/
App.flow = (function(){
  const S=App.state, U=App.util, C=App.core, Rn=App.render, D=App.dom;

  function me(){ return S.players[S.turn]; }
  function opp(){ return S.players[1-S.turn]; }

  function snapshot(){
    S.history.push(U.deep({
      deck:S.deck, players:S.players, turn:S.turn, phase:S.phase, pending:S.pending,
      log:S.log, turnActionUsed:S.turnActionUsed
    }));
    if(S.history.length>80) S.history.shift();
  }
  function undo(){
    const snap = S.history.pop(); if(!snap) return;
    Object.assign(S, U.deep(snap));
    Rn.render();
  }
  function log(){ return Rn.log.apply(null, arguments); }

  function draw(p, n){
    const take = S.deck.splice(-n);
    p.hand.push(...take);
    if(take.length>0) log(`${p.name} draws ${take.length} card${take.length>1?"s":""}.`);
  }

  function startOfTurnDraw(p){
    C.startOfOwnerTurnMaintenance(p);
    let n = 1;
    if(p.id===1 && !p.drewTwo){ n=2; p.drewTwo=true; }
    draw(p, n);
  }

  function checkDeckOut(){
    if(S.deck.length===0){
      const p0=S.players[0], p1=S.players[1];
      const t0=C.totalHP(p0), t1=C.totalHP(p1);
      if(t0!==t1){
        const w = t0>t1 ? p0.name : p1.name;
        log(`Deck out → ${w} wins by totals (${t0} vs ${t1}).`,"good");
        freeze(); return true;
      }else{
        log(`Deck out: equal totals (${t0}). Continue until a Flagship falls.`,"muted");
      }
    }
    return false;
  }

  function freeze(){ document.querySelectorAll("button").forEach(b=>b.disabled=true); }
  function checkWin(){
    const p0=S.players[0], p1=S.players[1];
    if(C.flagshipDestroyed(p0)){ log("Player 2 wins (Player 1 Flagship destroyed).","good"); freeze(); }
    if(C.flagshipDestroyed(p1)){ log("Player 1 wins (Player 2 Flagship destroyed).","good"); freeze(); }
  }

  function actionGate(){ 
    if(S.turnActionUsed){ 
      Rn.setHint("You’ve already used your one action this turn. End Turn to proceed."); 
      return true; 
    }
    return false;
  }
  function markActionUsed(){ S.turnActionUsed = true; }

  // Build seed helper: create suit arrays that reproduce the given numbers
  function seedShip(base){
    const s = {
      id: base.id, name: base.name,
      engine: base.engine, hull: base.hull,
      shieldRating: base.shieldRating||0, shieldActive: !!base.shieldActive, shieldCooldown:0,
      weapons: [], weaponsInactiveTurns:0,
      alive:true, flagship:false, reflect:false,
      _clubs:    base.engine>0        ? [base.engine]       : [],
      _hearts:   base.hull>0          ? [base.hull]         : [],
      _diamonds: (base.shieldRating||0)>0 ? [base.shieldRating] : [],
      _spades: []
    };
    C.recomputeStats(s);
    return s;
  }

  /* ----- Init ----- */
  function initGame(){
    try{
      S.deck = U.makeDeck();

      // starters (seed suit arrays so recompute works)
      S.players[0].ships = [
        seedShip({id:"p1a", name:"P1 Ship A", engine:3, hull:2, shieldRating:2, shieldActive:true}),
        seedShip({id:"p1b", name:"P1 Ship B", engine:4, hull:5, shieldRating:0, shieldActive:false})
      ];
      S.players[1].ships = [
        seedShip({id:"p2a", name:"P2 Ship A", engine:2, hull:3, shieldRating:3, shieldActive:true}),
        seedShip({id:"p2b", name:"P2 Ship B", engine:5, hull:4, shieldRating:0, shieldActive:false})
      ];

      // hands P1:7, P2:6 (Ace guaranteed)
      S.players[0].hand = S.deck.splice(-7); App.core.guaranteeAce(S.players[0].hand, S.deck);
      S.players[1].hand = S.deck.splice(-6); App.core.guaranteeAce(S.players[1].hand, S.deck);

      S.turn = 0;
      S.players[0].drewTwo = true;  // P2 draws 2 on first turn
      S.players[1].drewTwo = false;

      S.log = [];
      S.phase = "idle";
      S.pending = null;
      S.history = [];
      S.turnActionUsed = false;

      log(`Game started. Player 1 begins. Player 2 will draw 2 on their first turn.`);
      startOfTurnDraw(S.players[0]);
      Rn.render();
    }catch(e){
      console.error("[initGame] failed:", e);
      Rn.log("Init error: "+e.message, "bad");
    }
  }

  /* ----- Turn Flow ----- */
  function endTurn(){
    snapshot();
    if(checkDeckOut()) return;

    S.turn = 1-S.turn;
    S.phase = "idle"; S.pending=null;
    S.turnActionUsed = false;

    const p = S.players[S.turn];
    startOfTurnDraw(p);
    checkWin();
    Rn.render();

    App.ai.runIfNeeded();
  }

  /* ----- Top-level Actions ----- */
  function beginBuild(){
    if(actionGate()) return;
    S.phase="build_pick";
    S.pending={type:"build", firstIdx:null, selectedIdx:null, pairIdx:null};
    Rn.setHint("Build: tap a card (♣ Engine, ♥ Hull, ♦ Shield, ♠ Weapon ≤ Engine). Tap ♣ then ♥ (or vice versa) to LAUNCH a new ship.");
    Rn.render();
  }
  function beginAttack(){ if(actionGate()) return; S.phase="attack_select_attacker"; S.pending={type:"attack"}; Rn.setHint("Attack: select your attacking ship (must have weapons)."); Rn.render(); }
  function beginCrown(){
    if(actionGate()) return;
    const p = me();
    const idx = p.hand.findIndex(c=>c.rank===1 && c.suit!=="JOKER");
    if(idx<0){ Rn.setHint("You have no Ace."); return; }
    S.phase="crown_select_ship"; S.pending={type:"crown", cardIdx:idx};
    Rn.setHint("Select a ship to crown (Engine becomes at least 5)."); Rn.render();
  }
  function applyCrown(shipId){
    snapshot();
    const p = me();
    const i = S.pending.cardIdx;
    const ship = p.ships.find(s=>s.id===shipId && s.alive);
    if(!ship) return;
    ship.flagship=true; if(ship.engine<5) { ship._clubs.push(5); C.recomputeStats(ship); }
    p.hand.splice(i,1);
    log(`${p.name} crowns ${ship.name}. Engine ≥ 5.`,"good");
    S.phase="idle"; S.pending=null; markActionUsed(); Rn.render(); checkWin(); App.ai.runIfNeeded();
  }

  /* ----- Build Selection / Launch Pair ----- */
  function handleBuildSelectCard(cardIdx){
    const p = me();
    const card = p.hand[cardIdx];
    if(!card) return;

    // Specials / Joker → target phase
    if(card.suit==="JOKER" || (card.suit==="S" && [11,12,13].includes(card.rank))){
      S.phase="special_target"; S.pending={type:"special", cardIdx, card};
      if(card.suit==="JOKER") Rn.setHint("Joker: select an enemy ship with weapons (they go inactive for 1 turn).");
      else if(card.rank===11) Rn.setHint("J♠: select any enemy ship (3 Hull, bypass Shields).");
      else if(card.rank===12) Rn.setHint("Q♠: select your ship for reflect (≤5 on its next attack).");
      else if(card.rank===13) Rn.setHint("K♠: select any enemy ship (7 Hull, bypass Shields).");
      Rn.render();
      return;
    }

    if(S.phase!=="build_pick" && S.phase!=="build_target"){ beginBuild(); }

    // If first of a pair (♣ or ♥) for launching
    if(card.suit==="C" || card.suit==="H"){
      if(S.pending.firstIdx===null){
        S.pending.firstIdx = cardIdx;
        S.pending.selectedIdx = cardIdx;   // allow single-card install too
        S.phase = "build_target";
        const need = (card.suit==="C") ? "♥" : "♣";
        Rn.setHint(`Selected ${U.lbl(card)}. Tap a highlighted ship to install, or select a ${need} to LAUNCH a new ship.`);
        Rn.render();
        return;
      }else{
        const first = p.hand[S.pending.firstIdx];
        const suits = [first.suit, card.suit].sort().join("");
        if(suits==="CH" && cardIdx!==S.pending.firstIdx){
          S.pending.pairIdx = cardIdx;
          S.pending.selectedIdx = null;
          S.phase = "launch_pair";
          Rn.setHint("Launch ready: press **Confirm Launch**.");
          Rn.render();
          return;
        }else{
          S.pending.firstIdx = cardIdx;
          S.pending.selectedIdx = cardIdx;
          S.pending.pairIdx = null;
          S.phase = "build_target";
          const need2 = (card.suit==="C") ? "♥" : "♣";
          Rn.setHint(`Selected ${U.lbl(card)}. Tap a highlighted ship to install, or select a ${need2} to LAUNCH a new ship.`);
          Rn.render();
          return;
        }
      }
    }

    // For ♦ or normal ♠ (2–10): just go to target
    S.pending.selectedIdx = cardIdx;
    S.phase = "build_target";

    const targets = C.eligibleBuildTargets(me(), card);
    if(targets.length===0){
      if(card.suit==="S"){
        const engines = me().ships.filter(s=>s.alive).map(s=>s.engine);
        const maxE = engines.length ? Math.max(...engines) : 0;
        Rn.setHint(`No valid targets for ${U.lbl(card)}. Highest Engine is ${maxE}. Upgrade ♣ first or pick another card.`);
      }else{
        Rn.setHint(`No valid targets: build only on your living ships.`);
      }
    }else{
      Rn.setHint(`Build: tap a **highlighted** ship to install ${U.lbl(card)}.`);
    }
    Rn.render();
  }

  function confirmLaunch(){
    const p = me();
    const pend = S.pending;
    if(S.phase!=="launch_pair" || !Number.isInteger(pend?.firstIdx) || !Number.isInteger(pend?.pairIdx)) return;

    snapshot();

    const a = pend.firstIdx, b = pend.pairIdx;
    const cA = p.hand[a], cB = p.hand[b];
    const club = (cA.suit==="C") ? cA : cB;
    const heart = (cB.suit==="H") ? cB : cA;
    if(!(club && heart)){ S.history.pop(); return; }

    const aliveCount = p.ships.filter(s=>s.alive).length;
    if(aliveCount >= S.maxFleet && !p.ships.some(s=>!s.alive)){
      Rn.setHint(`Fleet is full (cap ${S.maxFleet}). Destroy a ship first or install instead.`);
      S.history.pop(); return;
    }

    const nid = `${p.id===0?"p1":"p2"}n${Date.now()%100000}`;
    const newShip = {
      id:nid, name:`${p.name} New Ship`,
      engine:0, hull:0, shieldRating:0, shieldActive:false, shieldCooldown:0,
      weapons:[], weaponsInactiveTurns:0, alive:true, flagship:false, reflect:false,
      _clubs:[club.rank], _hearts:[heart.rank], _diamonds:[], _spades:[]
    };
    C.recomputeStats(newShip);
    p.ships.push(newShip);

    [a,b].sort((x,y)=>y-x).forEach(i=>p.hand.splice(i,1));

    log(`${p.name} launches a new ship (E:${club.rank} H:${heart.rank}).`,"good");
    S.phase="idle"; S.pending=null; markActionUsed(); Rn.render(); App.ai.runIfNeeded();
  }

  function applyBuildToShip(shipId){
    if(S.phase==="launch_pair"){ confirmLaunch(); return; }
    if(S.phase!=="build_target" || S.pending?.selectedIdx==null) return;

    snapshot();

    const p = me(); 
    const cardIdx = S.pending.selectedIdx;
    const card = p.hand[cardIdx];
    const ship = p.ships.find(s=>s.id===shipId);
    if(!card || !ship){ S.history.pop(); return; }

    C.ensureSuitArrays(ship);

    if(!C.canApplyCardToShip(card, ship, p.id)){
      Rn.setHint("That card can't be installed on that ship.");
      S.history.pop();
      return;
    }

    // Stacking rule implementations by suit
    if(card.suit==="C"){            // Engines: base=max, +1 per extra ♣
      ship._clubs.push(card.rank);
      C.recomputeStats(ship);
      p.hand.splice(cardIdx,1);
      log(`${p.name} upgrades Engine on ${ship.name} → ${ship.engine} (stacking).`);
    }
    else if(card.suit==="H"){       // Hull: base=max, +1 per extra ♥ (increase current hull by delta)
      const before = C.suitTotal(ship._hearts);
      ship._hearts.push(card.rank);
      const after  = C.suitTotal(ship._hearts);
      const delta  = Math.max(0, after - before);
      ship.hull += delta;
      C.recomputeStats(ship);
      p.hand.splice(cardIdx,1);
      log(`${p.name} reinforces Hull on ${ship.name} (+${delta}) → H${ship.hull}.`);
    }
    else if(card.suit==="D"){       // Shields: base=max, +1 per extra ♦ ; re-activate on install
      ship._diamonds.push(card.rank);
      C.recomputeStats(ship);
      ship.shieldActive = ship.shieldRating>0;
      ship.shieldCooldown = 0;
      p.hand.splice(cardIdx,1);
      log(`${p.name} sets Shield ${ship.shieldRating} on ${ship.name} (active).`);
    }
    else if(card.suit==="S"){       // Weapons: base=max, +1 per extra ♠
      ship._spades.push(card.rank);
      ship.weapons = [...ship._spades];
      p.hand.splice(cardIdx,1);
      log(`${p.name} installs weapon ${card.rank}♠ on ${ship.name}.`);
    }

    S.phase="idle"; S.pending=null; markActionUsed(); Rn.render(); App.ai.runIfNeeded();
  }

  /* ----- Specials ----- */
  function applySpecialOn(targetId){
    snapshot();
    const p = me(), o = opp(); const pend = S.pending; if(!pend) return;
    const card = p.hand[pend.cardIdx]; if(!card) { S.history.pop(); return; }

    if(card.suit==="JOKER"){
      const tgt = o.ships.find(s=>s.id===targetId && s.alive);
      if(!tgt || (tgt._spades||tgt.weapons).length===0){ S.history.pop(); return; }
      tgt.weaponsInactiveTurns = Math.max(tgt.weaponsInactiveTurns, 1);
      p.hand.splice(pend.cardIdx,1);
      log(`${p.name} plays Joker: ${o.name}'s ${tgt.name} weapons go inactive for 1 turn.`,"warn");
    }else if(card.suit==="S" && card.rank===11){
      const tgt = o.ships.find(s=>s.id===targetId && s.alive);
      if(!tgt){ S.history.pop(); return; }
      tgt.hull -= 3; if(tgt.hull<=0){tgt.hull=0; tgt.alive=false;}
      p.hand.splice(pend.cardIdx,1);
      log(`${p.name} plays J♠: 3 Hull to ${tgt.name} (bypass).`,"bad");
    }else if(card.suit==="S" && card.rank===12){
      const my = p.ships.find(s=>s.id===targetId && s.alive);
      if(!my){ S.history.pop(); return; }
      my.reflect = true; p.hand.splice(pend.cardIdx,1);
      log(`${p.name} plays Q♠: ${my.name} will reflect up to 5 on its next attack.`,"good");
    }else if(card.suit==="S" && card.rank===13){
      const tgt = o.ships.find(s=>s.id===targetId && s.alive);
      if(!tgt){ S.history.pop(); return; }
      tgt.hull -= 7; if(tgt.hull<=0){tgt.hull=0; tgt.alive=false;}
      p.hand.splice(pend.cardIdx,1);
      log(`${p.name} plays K♠: 7 Hull to ${tgt.name} (bypass).`,"bad");
    }else{
      S.history.pop(); return;
    }

    S.phase="idle"; S.pending=null; markActionUsed(); Rn.render(); checkWin(); App.ai.runIfNeeded();
  }

  /* ----- Attack ----- */
  function selectAttacker(shipId){
    if(S.turnActionUsed){ Rn.setHint("You’ve already used your one action this turn."); return; }
    const p = me();
    const sh = p.ships.find(s=>s.id===shipId && s.alive);
    if(!sh) return;
    const dmg = C.shipDamage(sh);
    if(dmg<=0){ Rn.setHint("That ship has no usable weapons."); return; }
    S.phase="attack_select_target"; S.pending={type:"attack", attackerId: shipId, dmg};
    Rn.setHint(`Attack: select an enemy target (damage = ${dmg}).`); Rn.render();
  }
  function performAttackOn(targetId){
    snapshot();
    const p=me(), o=opp(); const pend=S.pending; if(!pend) return;
    const atk = p.ships.find(s=>s.id===pend.attackerId && s.alive);
    const tgt = o.ships.find(s=>s.id===targetId && s.alive);
    if(!atk || !tgt){ S.history.pop(); return; }
    const dmg = C.shipDamage(atk);
    C.applyDamage(tgt, dmg, {bypassShields:false});
    log(`${p.name} attacks with ${atk.name} for ${dmg} → ${o.name}'s ${tgt.name} ${tgt.alive?`(H${tgt.hull} Sh${tgt.shieldActive? tgt.shieldRating:0})`:"destroyed!"}`, tgt.alive?"":"bad");

    if(atk.reflect){
      const ref = Math.min(5, dmg);
      C.applyDamage(atk, ref, {bypassShields:false});
      log(`Reflect triggers on ${atk.name}: takes ${ref}.`,"muted");
      atk.reflect=false;
    }

    S.phase="idle"; S.pending=null; markActionUsed(); Rn.render(); checkWin(); App.ai.runIfNeeded();
  }

  /* ----- Public ----- */
  return {
    initGame, endTurn, beginBuild, beginAttack, beginCrown, applyCrown,
    handleBuildSelectCard, confirmLaunch, applyBuildToShip,
    applySpecialOn, selectAttacker, performAttackOn,
    undo
  };
})();
/*========[ /SECTION ]========*/


/*========[ SECTION: AI (public) ]========*/
App.ai = (function(){
  const S=App.state, C=App.core, F=App.flow, D=App.dom;
  let __busy=false;

  function runIfNeeded(){
    const aiOn = D.get("aiToggle") ? D.get("aiToggle").checked : true;
    if (!aiOn) return;
    if (S.turn !== 1) return;
    if (S.phase !== "idle") return;
    if (__busy) return;

    __busy = true;

    // If P2 already used its action this turn, just end turn
    if (S.turnActionUsed) {
      __busy = false; F.endTurn(); return;
    }

    try{
      const sel = D.get("aiDifficulty");
      const diff = sel ? sel.value : "normal";
      if (diff === "easy")      easy();
      else if (diff === "hard") hard();
      else                      normal();
    }catch(e){
      console.error("AI error:", e);
      __busy=false; F.endTurn(); return;
    }

    __busy=false;
    if (S.turn === 1) runIfNeeded(); // consume turn
  }

  function chooseWeakestEnemy(){ return C.weakestEnemyShip(S.turn); }

  function easy(){
    const p = S.players[S.turn], o=S.players[1-S.turn];
    const choices = [];
    const aceIdx = p.hand.findIndex(c=>c.rank===1 && c.suit!=="JOKER");
    if(aceIdx>=0 && !p.ships.some(s=>s.flagship)) choices.push(()=>{ S.pending={type:"crown",cardIdx:aceIdx}; F.applyCrown(p.ships[0].id); });
    const specials = p.hand.filter(c=>c.suit==="JOKER" || (c.suit==="S" && [11,12,13].includes(c.rank)));
    if(specials.length) choices.push(()=>{
      const card = specials[Math.floor(Math.random()*specials.length)];
      S.pending={type:"special",cardIdx:p.hand.indexOf(card),card};
      const enemies = o.ships.filter(s=>s.alive);
      const mine = p.ships.filter(s=>s.alive);
      const tgt = card.suit==="S"&&card.rank===12 ? mine[0] : enemies[0];
      F.applySpecialOn(tgt.id);
    });
    const sp = p.hand.filter(c=>c.suit==="S" && c.rank>=2 && c.rank<=10);
    if(sp.length) choices.push(()=>{
      const c = sp[Math.floor(Math.random()*sp.length)];
      const fit = p.ships.find(s=>s.alive && c.rank<=s.engine) || p.ships[0];
      S.phase="build_pick"; S.pending={type:"build",firstIdx:null,selectedIdx:null,pairIdx:null};
      F.handleBuildSelectCard(p.hand.indexOf(c)); F.applyBuildToShip(fit.id);
    });
    const club = p.hand.find(c=>c.suit==="C"), heart = p.hand.find(c=>c.suit==="H");
    if(club && heart) choices.push(()=>{
      S.phase="build_pick"; S.pending={type:"build",firstIdx:null,selectedIdx:null,pairIdx:null};
      F.handleBuildSelectCard(p.hand.indexOf(club));
      F.handleBuildSelectCard(p.hand.indexOf(heart));
      F.confirmLaunch();
    });
    const atk = p.ships.find(s=>s.alive && C.shipDamage(s)>0);
    const tar = S.players[1-S.turn].ships.find(s=>s.alive);
    if(atk && tar) choices.push(()=>{ S.phase="attack_select_target"; S.pending={type:"attack",attackerId:atk.id}; F.performAttackOn(tar.id); });

    if(!choices.length){ F.endTurn(); return; }
    choices[Math.floor(Math.random()*choices.length)]();
  }

  function normal(){
    const p = S.players[S.turn], o=S.players[1-S.turn];
    const aceIdx = p.hand.findIndex(c=>c.rank===1 && c.suit!=="JOKER");
    if(aceIdx>=0 && !p.ships.some(s=>s.flagship)){
      S.pending={type:"crown",cardIdx:aceIdx};
      const best = p.ships.filter(s=>s.alive).sort((a,b)=>(b.engine+b.hull+(b.shieldActive?b.shieldRating:0))-(a.engine+a.hull+(a.shieldActive?a.shieldRating:0)))[0];
      F.applyCrown(best.id); return;
    }
    const K = p.hand.findIndex(c=>c.suit==="S"&&c.rank===13);
    let target = chooseWeakestEnemy();
    if(K>=0 && target && target.hull<=7){ S.pending={type:"special",cardIdx:K,card:p.hand[K]}; F.applySpecialOn(target.id); return; }
    const J = p.hand.findIndex(c=>c.suit==="S"&&c.rank===11);
    target = chooseWeakestEnemy();
    if(J>=0 && target && target.hull<=3){ S.pending={type:"special",cardIdx:J,card:p.hand[J]}; F.applySpecialOn(target.id); return; }

    const sp = p.hand.filter(c=>c.suit==="S" && c.rank>=2 && c.rank<=10).sort((a,b)=>a.rank-b.rank)[0];
    if(sp){
      const fit = p.ships.filter(s=>s.alive && sp.rank<=s.engine).sort((a,b)=>C.shipDamage(a)-C.shipDamage(b))[0];
      if(fit){
        S.phase="build_pick"; S.pending={type:"build",firstIdx:null,selectedIdx:null,pairIdx:null};
        F.handleBuildSelectCard(p.hand.indexOf(sp)); F.applyBuildToShip(fit.id); return;
      }
    }
    const club = p.hand.find(c=>c.suit==="C"), heart = p.hand.find(c=>c.suit==="H");
    if(club && heart){
      const aliveCount = p.ships.filter(s=>s.alive).length;
      if(aliveCount < S.maxFleet || p.ships.some(s=>!s.alive)){
        S.phase="build_pick"; S.pending={type:"build",firstIdx:null,selectedIdx:null,pairIdx:null};
        F.handleBuildSelectCard(p.hand.indexOf(club));
        F.handleBuildSelectCard(p.hand.indexOf(heart));
        F.confirmLaunch(); return;
      }
    }
    if(sp){
      const need = sp.rank;
      const clubUp = p.hand.filter(c=>c.suit==="C").sort((a,b)=>b.rank-a.rank)[0];
      const tgt = p.ships.filter(s=>s.alive).sort((a,b)=>a.engine-b.engine)[0];
      if(clubUp && tgt && tgt.engine<need){
        S.phase="build_pick"; S.pending={type:"build",firstIdx:null,selectedIdx:null,pairIdx:null};
        F.handleBuildSelectCard(p.hand.indexOf(clubUp)); F.applyBuildToShip(tgt.id); return;
      }
    }
    const heartUp = p.hand.filter(c=>c.suit==="H").sort((a,b)=>a.rank-b.rank)[0];
    if(heartUp){
      const s = p.ships.filter(s=>s.alive).sort((a,b)=>(a.hull+(a.shieldActive?a.shieldRating:0))-(b.hull+(b.shieldActive?b.shieldRating:0)))[0];
      S.phase="build_pick"; S.pending={type:"build",firstIdx:null,selectedIdx:null,pairIdx:null};
      F.handleBuildSelectCard(p.hand.indexOf(heartUp)); F.applyBuildToShip(s.id); return;
    }
    const diam = p.hand.filter(c=>c.suit==="D").sort((a,b)=>b.rank-a.rank)[0];
    if(diam){
      const s = p.ships.filter(s=>s.alive).sort((a,b)=>(a.shieldRating - b.shieldRating))[0];
      S.phase="build_pick"; S.pending={type:"build",firstIdx:null,selectedIdx:null,pairIdx:null};
      F.handleBuildSelectCard(p.hand.indexOf(diam)); F.applyBuildToShip(s.id); return;
    }
    const jok = p.hand.findIndex(c=>c.suit==="JOKER");
    const gun = S.players[1-S.turn].ships.filter(s=>s.alive && C.shipDamage(s)>0).sort((a,b)=>C.shipDamage(b)-C.shipDamage(a))[0];
    if(jok>=0 && gun){ S.pending={type:"special",cardIdx:jok,card:p.hand[jok]}; F.applySpecialOn(gun.id); return; }

    const atk = p.ships.filter(s=>s.alive && C.shipDamage(s)>0).sort((a,b)=>C.shipDamage(b)-C.shipDamage(a))[0];
    const tar = chooseWeakestEnemy();
    if(atk && tar){ S.phase="attack_select_target"; S.pending={type:"attack",attackerId:atk.id}; F.performAttackOn(tar.id); return; }

    F.endTurn();
  }

  function hard(){
    const p = S.players[S.turn];
    const enemyFlag = S.players[1-S.turn].ships.find(s=>s.flagship && s.alive);

    const aceIdx = p.hand.findIndex(c=>c.rank===1 && c.suit!=="JOKER");
    if(aceIdx>=0 && !p.ships.some(s=>s.flagship)){
      S.pending={type:"crown",cardIdx:aceIdx};
      const best = p.ships.filter(s=>s.alive).sort((a,b)=>{
        const A = b.engine + b.hull + (b.shieldActive?b.shieldRating:0);
        const B = a.engine + a.hull + (a.shieldActive?a.shieldRating:0);
        return A-B;
      })[0];
      F.applyCrown(best.id); return;
    }

    const K = p.hand.findIndex(c=>c.suit==="S"&&c.rank===13);
    if(K>=0){
      const lethal = S.players[1-S.turn].ships.find(s=>s.alive && s.hull<=7) || enemyFlag;
      if(lethal){ S.pending={type:"special",cardIdx:K,card:p.hand[K]}; F.applySpecialOn(lethal.id); return; }
    }
    const J = p.hand.findIndex(c=>c.suit==="S"&&c.rank===11);
    if(J>=0){
      const lethal3 = S.players[1-S.turn].ships.find(s=>s.alive && s.hull<=3) || (enemyFlag && enemyFlag.hull<=3 ? enemyFlag : null);
      if(lethal3){ S.pending={type:"special",cardIdx:J,card:p.hand[J]}; F.applySpecialOn(lethal3.id); return; }
    }

    const sp = p.hand.filter(c=>c.suit==="S" && c.rank>=2 && c.rank<=10).sort((a,b)=>a.rank-b.rank)[0];
    if(sp){
      const fit = p.ships.filter(s=>s.alive && sp.rank<=s.engine).sort((a,b)=>C.shipDamage(a)-C.shipDamage(b))[0];
      if(fit){
        S.phase="build_pick"; S.pending={type:"build",firstIdx:null,selectedIdx:null,pairIdx:null};
        F.handleBuildSelectCard(p.hand.indexOf(sp)); F.applyBuildToShip(fit.id); return;
      }
    }
    if(sp){
      const need = sp.rank;
      const clubUp = p.hand.filter(c=>c.suit==="C").sort((a,b)=>b.rank-a.rank)[0];
      const tgt = p.ships.filter(s=>s.alive).sort((a,b)=>a.engine-b.engine)[0];
      if(clubUp && tgt && tgt.engine<need){
        S.phase="build_pick"; S.pending={type:"build",firstIdx:null,selectedIdx:null,pairIdx:null};
        F.handleBuildSelectCard(p.hand.indexOf(clubUp)); F.applyBuildToShip(tgt.id); return;
      }
    }
    const club = p.hand.find(c=>c.suit==="C"), heart = p.hand.find(c=>c.suit==="H");
    if(club && heart){
      const aliveCount = p.ships.filter(s=>s.alive).length;
      const canLaunch = (aliveCount < S.maxFleet) || p.ships.some(s=>!s.alive);
      if(canLaunch){
        S.phase="build_pick"; S.pending={type:"build",firstIdx:null,selectedIdx:null,pairIdx:null};
        F.handleBuildSelectCard(p.hand.indexOf(club));
        F.handleBuildSelectCard(p.hand.indexOf(heart));
        F.confirmLaunch(); return;
      }
    }
    const heartUp = p.hand.filter(c=>c.suit==="H").sort((a,b)=>a.rank-b.rank)[0];
    if(heartUp){
      const s = p.ships.filter(s=>s.alive).sort((a,b)=>{
        const A = (a.hull + (a.shieldActive?a.shieldRating:0));
        const B = (b.hull + (b.shieldActive?b.shieldRating:0));
        return A-B;
      })[0];
      S.phase="build_pick"; S.pending={type:"build",firstIdx:null,selectedIdx:null,pairIdx:null};
      F.handleBuildSelectCard(p.hand.indexOf(heartUp)); F.applyBuildToShip(s.id); return;
    }
    const diam = p.hand.filter(c=>c.suit==="D").sort((a,b)=>b.rank-a.rank)[0];
    if(diam){
      const s = p.ships.filter(s=>s.alive).sort((a,b)=>a.shieldRating - b.shieldRating)[0];
      S.phase="build_pick"; S.pending={type:"build",firstIdx:null,selectedIdx:null,pairIdx:null};
      F.handleBuildSelectCard(p.hand.indexOf(diam)); F.applyBuildToShip(s.id); return;
    }
    const jok = p.hand.findIndex(c=>c.suit==="JOKER");
    const gun = S.players[1-S.turn].ships.filter(s=>s.alive && C.shipDamage(s)>0)
                  .sort((a,b)=> (C.shipDamage(b) - C.shipDamage(a)) || ((b.flagship?1:0)-(a.flagship?1:0)) )[0];
    if(jok>=0 && gun){ S.pending={type:"special",cardIdx:jok,card:p.hand[jok]}; F.applySpecialOn(gun.id); return; }

    const atk = p.ships.filter(s=>s.alive && C.shipDamage(s)>0).sort((a,b)=>C.shipDamage(b)-C.shipDamage(a))[0];
    let tar = (S.players[1-S.turn].ships.find(s=>s.flagship && s.alive)) || C.weakestEnemyShip(S.turn);
    if(atk && tar){ S.phase="attack_select_target"; S.pending={type:"attack",attackerId:atk.id}; F.performAttackOn(tar.id); return; }

    F.endTurn();
  }

  return { runIfNeeded, easy, normal, hard };
})();
/*========[ /SECTION ]========*/


/*========[ SECTION: TESTS / DIAGNOSTICS (public) ]========*/
App.tests = {
  sanity(){
    const A=App.util.assert, S=App.state;
    A(S.players.length===2,"two players");
    S.players.forEach((p,i)=> A(Array.isArray(p.ships), "ships arr p"+i));
    ["controlsCol","board","hand","log"].forEach(id=> App.util.$(id) || console.warn("Missing #"+id));
    return "OK";
  }
};
/*========[ /SECTION ]========*/


/*========[ SECTION: WIRING / STARTUP ]========*/
(function startup(){
  function wire(){
    const w = [
      ["btnBuild", ()=>App.flow.beginBuild()],
      ["btnAttack", ()=>App.flow.beginAttack()],
      ["btnCrown",  ()=>App.flow.beginCrown()],
      ["btnUndo",   ()=>App.flow.undo()],
      ["btnEndTurn",()=>App.flow.endTurn()],
      ["btnNewGame",()=>App.flow.initGame()],
      ["btnConfirmLaunch",()=>App.flow.confirmLaunch()],
    ];
    w.forEach(([id,fn])=>{ const el=App.dom.get(id); if(el) el.addEventListener("click", fn); });

    const tgl = App.dom.get("aiToggle");
    if (tgl) tgl.addEventListener("change", ()=> App.ai.runIfNeeded());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ()=>{ wire(); App.flow.initGame(); });
  } else {
    wire(); App.flow.initGame();
  }
})();
/*========[ /SECTION ]========*/