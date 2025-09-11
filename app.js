/* ================= Utilities ================= */
const SUITS = ["C","H","D","S"];
const RANKS = [1,2,3,4,5,6,7,8,9,10,11,12,13]; // A=1
const deep = (o)=>JSON.parse(JSON.stringify(o));
const sum = arr => arr.reduce((a,b)=>a+b,0);
const lbl = (c)=> c.suit==="JOKER" ? "Joker" : ({1:"A",11:"J",12:"Q",13:"K"}[c.rank]||c.rank)+({C:"♣",H:"♥",D:"♦",S:"♠"}[c.suit]);

function makeDeck(){
  const deck = [];
  for(const s of SUITS){ for(const r of RANKS){ deck.push({suit:s, rank:r}); } }
  deck.push({suit:"JOKER",rank:0}); deck.push({suit:"JOKER",rank:0});
  for(let i=deck.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [deck[i],deck[j]]=[deck[j],deck[i]]; }
  return deck;
}

/* ================= Game State ================= */
const state = {
  deck: [],
  players: [
    { id:0, name:"Player 1", color:"p1", hand:[], ships:[], drewTwo:false },
    { id:1, name:"Player 2", color:"p2", hand:[], ships:[], drewTwo:false },
  ],
  turn: 0,
  log: [],
  // Phases: idle | build_pick | build_target | launch_pair | attack_select_attacker | attack_select_target | crown_select_ship | special_target
  phase: "idle",
  pending: null,    // varies per phase (see beginBuild/handleBuildSelectCard)
  history: [],
  turnActionUsed: false,
  maxFleet: 3
};

/* ================= DOM Shortcuts ================= */
const $ = (id)=>document.getElementById(id);

/* ================= History / Undo ================= */
function snapshot(){
  state.history.push(deep({
    deck:state.deck, players:state.players, turn:state.turn, phase:state.phase, pending:state.pending,
    log:state.log, turnActionUsed:state.turnActionUsed
  }));
  if(state.history.length>80) state.history.shift();
}
function undo(){
  const snap = state.history.pop(); if(!snap) return;
  Object.assign(state, deep(snap));
  render();
}

/* ================= Helpers ================= */
function guaranteeAce(hand, deck){
  if(!hand.some(c=>c.rank===1)){
    const idx = deck.findIndex(c=>c.rank===1 && c.suit!=="JOKER");
    if(idx>=0){ hand.push(deck.splice(idx,1)[0]); }
  }
}
function roleOf(ship){
  const E=ship.engine, H=ship.hull;
  if(ship.weapons.length===0 || E===H) return "Support";
  if(E>H) return "Speed";
  return "Tank";
}
function usableWeapons(ship){
  if(ship.weaponsInactiveTurns>0) return [];
  const w = ship.weapons.filter(v=>v<=ship.engine);
  return w;
}
function shipDamage(ship){
  const w = usableWeapons(ship);
  if(w.length===0) return roleOf(ship)==="Speed" ? 2 : 0;
  const base = Math.max(...w);
  const stack = w.length-1;
  let dmg = base + stack;
  if(roleOf(ship)==="Speed") dmg += 2;
  return Math.max(0,dmg);
}

/* Shields: rating + active flag + 1-turn cooldown */
function applyDamage(target, amount, {bypassShields=false}={}){
  let dealt = 0;
  if(!bypassShields && target.shieldActive && target.shieldRating>0 && amount>0){
    const absorbed = Math.min(amount, target.shieldRating);
    amount -= absorbed; dealt += absorbed;
    target.shieldActive = false;
    target.shieldCooldown = 1; // 1 owner-turn
    const el = document.querySelector(`[data-sid="${target.id}"] .shieldArc`);
    if(el){ el.classList.remove('ping'); void el.offsetWidth; el.classList.add('ping'); }
  }
  if(amount>0){
    target.hull -= amount;
    dealt += amount;
    if(target.hull<=0){ target.hull=0; target.alive=false; }
  }
  return dealt;
}
function totalHP(p){
  return sum(p.ships.filter(s=>s.alive).map(s=> s.hull + (s.shieldActive ? s.shieldRating : 0)));
}
function flagshipDestroyed(p){ return p.ships.some(s=>s.flagship) && !p.ships.some(s=>s.flagship && s.alive); }
function weakestEnemyShip(pid){
  const opp = state.players[1-pid];
  const alive = opp.ships.filter(s=>s.alive);
  alive.sort((a,b)=>(a.hull+(a.shieldActive?a.shieldRating:0))-(b.hull+(b.shieldActive?b.shieldRating:0)) || a.engine-b.engine);
  return alive[0] || null;
}
function startOfOwnerTurnMaintenance(p){
  for(const s of p.ships){
    if(s.alive && s.shieldCooldown>0){ s.shieldCooldown -= 1; if(s.shieldCooldown===0) s.shieldActive = true; }
    if(s.alive && s.weaponsInactiveTurns>0){ s.weaponsInactiveTurns -= 1; }
  }
}

/* ================= Init ================= */
function initGame(){
  state.deck = makeDeck();

  // starters
  state.players[0].ships = [
    {id:"p1a", name:"P1 Ship A", engine:3, hull:2, shieldRating:2, shieldActive:true, shieldCooldown:0, weapons:[], weaponsInactiveTurns:0, alive:true, flagship:false, reflect:false},
    {id:"p1b", name:"P1 Ship B", engine:4, hull:5, shieldRating:0, shieldActive:false, shieldCooldown:0, weapons:[], weaponsInactiveTurns:0, alive:true, flagship:false, reflect:false}
  ];
  state.players[1].ships = [
    {id:"p2a", name:"P2 Ship A", engine:2, hull:3, shieldRating:3, shieldActive:true, shieldCooldown:0, weapons:[], weaponsInactiveTurns:0, alive:true, flagship:false, reflect:false},
    {id:"p2b", name:"P2 Ship B", engine:5, hull:4, shieldRating:0, shieldActive:false, shieldCooldown:0, weapons:[], weaponsInactiveTurns:0, alive:true, flagship:false, reflect:false}
  ];

  // hands P1:7, P2:6 (Ace guaranteed)
  state.players[0].hand = state.deck.splice(-7); guaranteeAce(state.players[0].hand, state.deck);
  state.players[1].hand = state.deck.splice(-6); guaranteeAce(state.players[1].hand, state.deck);

  state.turn = 0;
  state.players[0].drewTwo = true;  // P2 will draw 2 on their first turn
  state.players[1].drewTwo = false;

  state.log = [];
  state.phase = "idle";
  state.pending = null;
  state.history = [];
  state.turnActionUsed = false;

  log(`Game started. Player 1 begins. Player 2 will draw 2 on their first turn.`);
  startOfTurnDraw(state.players[0]);
  render();
}

/* ================= Turn / Flow ================= */
function startOfTurnDraw(p){
  startOfOwnerTurnMaintenance(p);
  let n = 1;
  if(p.id===1 && !p.drewTwo){ n=2; p.drewTwo=true; }
  draw(p, n);
}
function draw(p, n){
  const take = state.deck.splice(-n);
  p.hand.push(...take);
  if(take.length>0) log(`${p.name} draws ${take.length} card${take.length>1?"s":""}.`);
}
function endTurn(){
  snapshot();
  if(state.deck.length===0){
    const p0=state.players[0], p1=state.players[1];
    const t0=totalHP(p0), t1=totalHP(p1);
    if(t0!==t1){
      const w = t0>t1 ? p0.name : p1.name;
      log(`Deck out → ${w} wins by totals (${t0} vs ${t1}).`,"good");
      freeze(); return;
    }else{
      log(`Deck out: equal totals (${t0}). Continue until a Flagship falls.`,"muted");
    }
  }
  state.turn = 1-state.turn;
  state.phase = "idle"; state.pending=null;
  state.turnActionUsed = false;

  const p = state.players[state.turn];
  startOfTurnDraw(p);
  checkWin();
  render();
  maybeRunAI();
}
function freeze(){ document.querySelectorAll("button").forEach(b=>b.disabled=true); }
function checkWin(){
  const p0=state.players[0], p1=state.players[1];
  if(flagshipDestroyed(p0)){ log("Player 2 wins (Player 1 Flagship destroyed).","good"); freeze(); }
  if(flagshipDestroyed(p1)){ log("Player 1 wins (Player 2 Flagship destroyed).","good"); freeze(); }
}

/* ================= Logging ================= */
function log(msg, cls=""){ state.log.unshift({msg,cls,t:Date.now()}); renderLog(); }

/* ================= One-Action Gate ================= */
function actionGate(){ 
  if(state.turnActionUsed){ 
    setHint("You’ve already used your one action this turn. End Turn to proceed."); 
    return true; 
  }
  return false;
}
function markActionUsed(){ state.turnActionUsed = true; }

/* ================= Action Logic ================= */
function beginBuild(){
  if(actionGate()) return;
  state.phase="build_pick";
  state.pending={type:"build", firstIdx:null, selectedIdx:null, pairIdx:null};
  setHint("Build: tap a card (♣ Engine, ♥ Hull, ♦ Shield, ♠ Weapon ≤ Engine). Tap ♣ then ♥ (or vice versa) to LAUNCH a new ship.");
  render();
}
function beginAttack(){ if(actionGate()) return; state.phase="attack_select_attacker"; state.pending={type:"attack"}; setHint("Attack: select your attacking ship (must have weapons)."); render(); }
function beginCrown(){
  if(actionGate()) return;
  const p = me();
  const idx = p.hand.findIndex(c=>c.rank===1 && c.suit!=="JOKER");
  if(idx<0){ setHint("You have no Ace."); return; }
  state.phase="crown_select_ship"; state.pending={type:"crown", cardIdx:idx};
  setHint("Select a ship to crown (Engine becomes at least 5)."); render();
}
function applyCrown(shipId){
  snapshot();
  const p = me();
  const i = state.pending.cardIdx;
  const ship = p.ships.find(s=>s.id===shipId && s.alive);
  if(!ship) return;
  ship.flagship=true; if(ship.engine<5) ship.engine=5;
  p.hand.splice(i,1);
  log(`${p.name} crowns ${ship.name}. Engine ≥ 5.`,"good");
  state.phase="idle"; state.pending=null; markActionUsed(); render(); checkWin(); maybeRunAI();
}
function me(){ return state.players[state.turn]; }
function opp(){ return state.players[1-state.turn]; }

/* ===== Build selection & launch pair (robust) ===== */
function handleBuildSelectCard(cardIdx){
  const p = me();
  const card = p.hand[cardIdx];
  if(!card) return;

  // Specials / Joker → target phase
  if(card.suit==="JOKER" || (card.suit==="S" && [11,12,13].includes(card.rank))){
    state.phase="special_target"; state.pending={type:"special", cardIdx, card};
    if(card.suit==="JOKER") setHint("Joker: select an enemy ship with weapons (they go inactive for 1 turn).");
    else if(card.rank===11) setHint("J♠: select any enemy ship (3 Hull, bypass Shields).");
    else if(card.rank===12) setHint("Q♠: select your ship for reflect (≤5 on its next attack).");
    else if(card.rank===13) setHint("K♠: select any enemy ship (7 Hull, bypass Shields).");
    render();
    return;
  }

  // Build flow
  if(state.phase!=="build_pick" && state.phase!=="build_target"){ 
    // if user clicks a card while not in build, start build
    beginBuild();
  }

  // If first of a pair (♣ or ♥)
  if(card.suit==="C" || card.suit==="H"){
    if(state.pending.firstIdx===null){
      state.pending.firstIdx = cardIdx;
      state.pending.selectedIdx = cardIdx;   // allow single-card install too
      state.phase = "build_target";
      const need = (card.suit==="C") ? "♥" : "♣";
      setHint(`Selected ${lbl(card)}. Tap a highlighted ship to install, or select a ${need} to LAUNCH a new ship.`);
      render();
      return;
    }else{
      // We already have a first; check if complementary
      const first = p.hand[state.pending.firstIdx];
      const suits = [first.suit, card.suit].sort().join("");
      if(suits==="CH" && cardIdx!==state.pending.firstIdx){
        state.pending.pairIdx = cardIdx;
        state.pending.selectedIdx = null;
        state.phase = "launch_pair";
        setHint("Launch ready: press **Confirm Launch**.");
        render();
        return;
      }else{
        // Not complementary → treat this as the new single selection
        state.pending.firstIdx = cardIdx;
        state.pending.selectedIdx = cardIdx;
        state.pending.pairIdx = null;
        state.phase = "build_target";
        const need = (card.suit==="C") ? "♥" : "♣";
        setHint(`Selected ${lbl(card)}. Tap a highlighted ship to install, or select a ${need} to LAUNCH a new ship.`);
        render();
        return;
      }
    }
  }

  // For ♦ or normal ♠ (2–10): just go to target
  state.pending.selectedIdx = cardIdx;
  state.phase = "build_target";

  // Compute if any valid targets exist
  const targets = eligibleBuildTargets(me(), card);
  if(targets.length===0){
    if(card.suit==="S"){
      const maxE = Math.max(...me().ships.filter(s=>s.alive).map(s=>s.engine));
      setHint(`No valid targets for ${lbl(card)}. Highest Engine is ${maxE}. Upgrade ♣ first or pick another card.`);
    }else{
      setHint(`No valid targets: build only on your living ships.`);
    }
  }else{
    setHint(`Build: tap a **highlighted** ship to install ${lbl(card)}.`);
  }
  render();
}

function eligibleBuildTargets(player, card){
  return player.ships.filter(s=> canApplyCardToShip(card, s, player.id) );
}

function canApplyCardToShip(card, ship, ownerId){
  if(!ship.alive) return false;
  if(ownerId!==me().id) return false; // own ships only during your turn
  if(card.suit==="C") return true;
  if(card.suit==="H") return true;
  if(card.suit==="D") return true; // set/refresh shield (reactivates)
  if(card.suit==="S" && card.rank>=2 && card.rank<=10) return card.rank <= ship.engine;
  return false;
}

function confirmLaunch(){
  const p = me();
  const pend = state.pending;
  if(state.phase!=="launch_pair" || !Number.isInteger(pend?.firstIdx) || !Number.isInteger(pend?.pairIdx)) return;

  snapshot();

  const a = pend.firstIdx, b = pend.pairIdx;
  const cA = p.hand[a], cB = p.hand[b];
  const club = (cA.suit==="C") ? cA : cB;
  const heart = (cB.suit==="H") ? cB : cA;
  if(!(club && heart)){ state.history.pop(); return; }

  const aliveCount = p.ships.filter(s=>s.alive).length;
  if(aliveCount >= state.maxFleet && !p.ships.some(s=>!s.alive)){
    setHint(`Fleet is full (cap ${state.maxFleet}). Destroy a ship first or install instead.`);
    state.history.pop(); return;
  }

  const nid = `${p.id===0?"p1":"p2"}n${Date.now()%100000}`;
  const newShip = {
    id:nid, name:`${p.name} New Ship`, engine:club.rank, hull:heart.rank,
    shieldRating:0, shieldActive:false, shieldCooldown:0,
    weapons:[], weaponsInactiveTurns:0, alive:true, flagship:false, reflect:false
  };
  p.ships.push(newShip);

  [a,b].sort((x,y)=>y-x).forEach(i=>p.hand.splice(i,1));

  log(`${p.name} launches a new ship (E:${club.rank} H:${heart.rank}).`,"good");
  state.phase="idle"; state.pending=null; markActionUsed(); render(); maybeRunAI();
}

function applyBuildToShip(shipId){
  if(state.phase==="launch_pair"){ confirmLaunch(); return; }
  if(state.phase!=="build_target" || state.pending?.selectedIdx==null) return;

  snapshot();

  const p = me(); 
  const cardIdx = state.pending.selectedIdx;
  const card = p.hand[cardIdx];
  const ship = p.ships.find(s=>s.id===shipId);
  if(!card || !ship){ state.history.pop(); return; }

  if(!canApplyCardToShip(card, ship, p.id)){
    setHint("That card can't be installed on that ship.");
    state.history.pop();
    return;
  }

  if(card.suit==="C"){ ship.engine=Math.max(ship.engine, card.rank); p.hand.splice(cardIdx,1); log(`${p.name} upgrades Engine on ${ship.name} → ${ship.engine}.`); }
  else if(card.suit==="H"){ ship.hull+=card.rank; p.hand.splice(cardIdx,1); log(`${p.name} adds ${card.rank} Hull to ${ship.name}.`); }
  else if(card.suit==="D"){
    ship.shieldRating = Math.max(ship.shieldRating, card.rank);
    ship.shieldActive = true; ship.shieldCooldown = 0;
    p.hand.splice(cardIdx,1);
    log(`${p.name} sets Shield ${ship.shieldRating} on ${ship.name} (active).`);
  }
  else if(card.suit==="S"){
    ship.weapons.push(card.rank);
    p.hand.splice(cardIdx,1);
    log(`${p.name} installs weapon ${card.rank}♠ on ${ship.name}.`);
  }

  state.phase="idle"; state.pending=null; markActionUsed(); render(); maybeRunAI();
}

/* ===== Specials ===== */
function applySpecialOn(targetId){
  snapshot();
  const p = me(), o = opp(); const pend = state.pending; if(!pend) return;
  const card = p.hand[pend.cardIdx]; if(!card) { state.history.pop(); return; }

  if(card.suit==="JOKER"){
    const tgt = o.ships.find(s=>s.id===targetId && s.alive);
    if(!tgt || tgt.weapons.length===0){ state.history.pop(); return; }
    tgt.weaponsInactiveTurns = Math.max(tgt.weaponsInactiveTurns, 1);
    p.hand.splice(pend.cardIdx,1);
    log(`${p.name} plays Joker: ${o.name}'s ${tgt.name} weapons go inactive for 1 turn.`,"warn");
  }else if(card.suit==="S" && card.rank===11){
    const tgt = o.ships.find(s=>s.id===targetId && s.alive);
    if(!tgt){ state.history.pop(); return; }
    tgt.hull -= 3; if(tgt.hull<=0){tgt.hull=0; tgt.alive=false;}
    p.hand.splice(pend.cardIdx,1);
    log(`${p.name} plays J♠: 3 Hull to ${tgt.name} (bypass).`,"bad");
  }else if(card.suit==="S" && card.rank===12){
    const my = p.ships.find(s=>s.id===targetId && s.alive);
    if(!my){ state.history.pop(); return; }
    my.reflect = true; p.hand.splice(pend.cardIdx,1);
    log(`${p.name} plays Q♠: ${my.name} will reflect up to 5 on its next attack.`,"good");
  }else if(card.suit==="S" && card.rank===13){
    const tgt = o.ships.find(s=>s.id===targetId && s.alive);
    if(!tgt){ state.history.pop(); return; }
    tgt.hull -= 7; if(tgt.hull<=0){tgt.hull=0; tgt.alive=false;}
    p.hand.splice(pend.cardIdx,1);
    log(`${p.name} plays K♠: 7 Hull to ${tgt.name} (bypass).`,"bad");
  }else{
    state.history.pop(); return;
  }

  state.phase="idle"; state.pending=null; markActionUsed(); render(); checkWin(); maybeRunAI();
}

/* ===== Attack ===== */
function selectAttacker(shipId){
  if(actionGate()) return;
  const p = me();
  const sh = p.ships.find(s=>s.id===shipId && s.alive);
  if(!sh) return;
  const dmg = shipDamage(sh);
  if(dmg<=0){ setHint("That ship has no usable weapons."); return; }
  state.phase="attack_select_target"; state.pending={type:"attack", attackerId: shipId, dmg};
  setHint(`Attack: select an enemy target (damage = ${dmg}).`); render();
}
function performAttackOn(targetId){
  snapshot();
  const p=me(), o=opp(); const pend=state.pending; if(!pend) return;
  const atk = p.ships.find(s=>s.id===pend.attackerId && s.alive);
  const tgt = o.ships.find(s=>s.id===targetId && s.alive);
  if(!atk || !tgt){ state.history.pop(); return; }
  const dmg = shipDamage(atk);
  applyDamage(tgt, dmg, {bypassShields:false});
  log(`${p.name} attacks with ${atk.name} for ${dmg} → ${o.name}'s ${tgt.name} ${tgt.alive?`(H${tgt.hull} Sh${tgt.shieldActive? tgt.shieldRating:0})`:"destroyed!"}`, tgt.alive?"":"bad");

  if(atk.reflect){
    const ref = Math.min(5, dmg);
    applyDamage(atk, ref, {bypassShields:false});
    log(`Reflect triggers on ${atk.name}: takes ${ref}.`,"muted");
    atk.reflect=false;
  }

  state.phase="idle"; state.pending=null; markActionUsed(); render(); checkWin(); maybeRunAI();
}

/* ===== AI (Player 2) with difficulty ===== */
// Replace your maybeRunAI with this version
// --- DROP-IN REPLACEMENT ---
let __aiTimer = null;

// Call this anywhere; it safely retries until the AI can act.
function maybeRunAI() {
  // 1) Must be P2's turn and AI enabled
  const aiOn = $("aiToggle") ? $("aiToggle").checked : true;  // default ON if the toggle is absent
  if (!aiOn) return;
  if (state.turn !== 1) return;

  // 2) If an action already consumed this turn, just end turn shortly
  if (state.turnActionUsed) {
    if (__aiTimer) clearTimeout(__aiTimer);
    __aiTimer = setTimeout(() => endTurn(), 120);
    return;
  }

  // 3) Only act from a clean idle; otherwise poll until idle
  if (state.phase !== "idle") {
    if (__aiTimer) clearTimeout(__aiTimer);
    __aiTimer = setTimeout(maybeRunAI, 80);
    return;
  }

  // 4) Debounced invoke of difficulty
  if (__aiTimer) clearTimeout(__aiTimer);
  __aiTimer = setTimeout(() => {
    const sel = $("aiDifficulty");
    const diff = sel ? sel.value : "normal";
    try {
      if (diff === "easy")      aiEasy();
      else if (diff === "hard") aiHard();
      else                      aiNormal();
    } catch (e) {
      console.error("AI error:", e);
      // fail-safe: don't brick the game turn
      endTurn();
    }
  }, 160);
}

// Keeps the AI from double-acting; only used by maybeRunAI
function aiTakeTurn() {
  // Not used anymore; left here for compatibility if referenced elsewhere
  return maybeRunAI();
}

// OPTIONAL: ensure the AI reacts when you toggle it on mid-turn
const _aiTgl = $("aiToggle");
if (_aiTgl) {
  _aiTgl.addEventListener("change", () => {
    // If you switch AI on during P2's turn, kick it immediately
    if (_aiTgl.checked) maybeRunAI();
  });
}

function aiEasy(){
  const p = me(), o = opp();
  const choices = [];
  const aceIdx = p.hand.findIndex(c=>c.rank===1 && c.suit!=="JOKER");
  if(aceIdx>=0 && !p.ships.some(s=>s.flagship)) choices.push(()=>{ state.pending={type:"crown",cardIdx:aceIdx}; applyCrown(p.ships[0].id); });
  const specials = p.hand.filter(c=>c.suit==="JOKER" || (c.suit==="S" && [11,12,13].includes(c.rank)));
  if(specials.length) choices.push(()=>{
    const card = specials[Math.floor(Math.random()*specials.length)];
    state.pending={type:"special",cardIdx:p.hand.indexOf(card),card};
    const enemies = o.ships.filter(s=>s.alive);
    const mine = p.ships.filter(s=>s.alive);
    const tgt = card.suit==="S"&&card.rank===12 ? mine[0] : enemies[0];
    applySpecialOn(tgt.id);
  });
  const sp = p.hand.filter(c=>c.suit==="S" && c.rank>=2 && c.rank<=10);
  if(sp.length) choices.push(()=>{
    const c = sp[Math.floor(Math.random()*sp.length)];
    const fit = p.ships.find(s=>s.alive && c.rank<=s.engine) || p.ships[0];
    // use the new build flow
    state.phase="build_pick"; state.pending={type:"build",firstIdx:null,selectedIdx:null,pairIdx:null};
    handleBuildSelectCard(p.hand.indexOf(c)); // moves to build_target
    applyBuildToShip(fit.id);
  });
  const club = p.hand.find(c=>c.suit==="C"), heart = p.hand.find(c=>c.suit==="H");
  if(club && heart) choices.push(()=>{
    state.phase="build_pick"; state.pending={type:"build",firstIdx:null,selectedIdx:null,pairIdx:null};
    handleBuildSelectCard(p.hand.indexOf(club));
    handleBuildSelectCard(p.hand.indexOf(heart));
    confirmLaunch();
  });
  const atk = p.ships.find(s=>s.alive && shipDamage(s)>0);
  const tar = opp().ships.find(s=>s.alive);
  if(atk && tar) choices.push(()=>{ state.phase="attack_select_target"; state.pending={type:"attack",attackerId:atk.id}; performAttackOn(tar.id); });

  if(!choices.length){ endTurn(); return; }
  choices[Math.floor(Math.random()*choices.length)]();
}

function aiNormal(){
  const p = me(), o = opp();
  const aceIdx = p.hand.findIndex(c=>c.rank===1 && c.suit!=="JOKER");
  if(aceIdx>=0 && !p.ships.some(s=>s.flagship)){
    state.pending={type:"crown",cardIdx:aceIdx};
    const best = p.ships.filter(s=>s.alive).sort((a,b)=>(b.engine+b.hull+(b.shieldActive?b.shieldRating:0))-(a.engine+a.hull+(a.shieldActive?a.shieldRating:0)))[0];
    applyCrown(best.id); return;
  }
  const K = p.hand.findIndex(c=>c.suit==="S"&&c.rank===13);
  let target = weakestEnemyShip(p.id);
  if(K>=0 && target && target.hull<=7){ state.pending={type:"special",cardIdx:K,card:p.hand[K]}; applySpecialOn(target.id); return; }
  const J = p.hand.findIndex(c=>c.suit==="S"&&c.rank===11);
  target = weakestEnemyShip(p.id);
  if(J>=0 && target && target.hull<=3){ state.pending={type:"special",cardIdx:J,card:p.hand[J]}; applySpecialOn(target.id); return; }

  const sp = p.hand.filter(c=>c.suit==="S" && c.rank>=2 && c.rank<=10).sort((a,b)=>a.rank-b.rank)[0];
  if(sp){
    const fit = p.ships.filter(s=>s.alive && sp.rank<=s.engine).sort((a,b)=>shipDamage(a)-shipDamage(b))[0];
    if(fit){
      state.phase="build_pick"; state.pending={type:"build",firstIdx:null,selectedIdx:null,pairIdx:null};
      handleBuildSelectCard(p.hand.indexOf(sp)); applyBuildToShip(fit.id); return;
    }
  }
  const club = p.hand.find(c=>c.suit==="C"), heart = p.hand.find(c=>c.suit==="H");
  if(club && heart){
    const aliveCount = p.ships.filter(s=>s.alive).length;
    if(aliveCount < state.maxFleet || p.ships.some(s=>!s.alive)){
      state.phase="build_pick"; state.pending={type:"build",firstIdx:null,selectedIdx:null,pairIdx:null};
      handleBuildSelectCard(p.hand.indexOf(club));
      handleBuildSelectCard(p.hand.indexOf(heart));
      confirmLaunch(); return;
    }
  }
  if(sp){
    const need = sp.rank;
    const clubUp = p.hand.filter(c=>c.suit==="C").sort((a,b)=>b.rank-a.rank)[0];
    const tgt = p.ships.filter(s=>s.alive).sort((a,b)=>a.engine-b.engine)[0];
    if(clubUp && tgt && tgt.engine<need){
      state.phase="build_pick"; state.pending={type:"build",firstIdx:null,selectedIdx:null,pairIdx:null};
      handleBuildSelectCard(p.hand.indexOf(clubUp)); applyBuildToShip(tgt.id); return;
    }
  }
  const heartUp = p.hand.filter(c=>c.suit==="H").sort((a,b)=>a.rank-b.rank)[0];
  if(heartUp){
    const s = p.ships.filter(s=>s.alive).sort((a,b)=>(a.hull+(a.shieldActive?a.shieldRating:0))-(b.hull+(b.shieldActive?b.shieldRating:0)))[0];
    state.phase="build_pick"; state.pending={type:"build",firstIdx:null,selectedIdx:null,pairIdx:null};
    handleBuildSelectCard(p.hand.indexOf(heartUp)); applyBuildToShip(s.id); return;
  }
  const diam = p.hand.filter(c=>c.suit==="D").sort((a,b)=>b.rank-a.rank)[0];
  if(diam){
    const s = p.ships.filter(s=>s.alive).sort((a,b)=>(a.shieldRating - b.shieldRating))[0];
    state.phase="build_pick"; state.pending={type:"build",firstIdx:null,selectedIdx:null,pairIdx:null};
    handleBuildSelectCard(p.hand.indexOf(diam)); applyBuildToShip(s.id); return;
  }
  const jok = p.hand.findIndex(c=>c.suit==="JOKER");
  const gun = opp().ships.filter(s=>s.alive && shipDamage(s)>0).sort((a,b)=>shipDamage(b)-shipDamage(a))[0];
  if(jok>=0 && gun){ state.pending={type:"special",cardIdx:jok,card:p.hand[jok]}; applySpecialOn(gun.id); return; }

  const atk = p.ships.filter(s=>s.alive && shipDamage(s)>0).sort((a,b)=>shipDamage(b)-shipDamage(a))[0];
  const tar = weakestEnemyShip(p.id);
  if(atk && tar){ state.phase="attack_select_target"; state.pending={type:"attack",attackerId:atk.id}; performAttackOn(tar.id); return; }

  endTurn();
}

function aiHard(){
  const p = me(), o = opp();
  const aceIdx = p.hand.findIndex(c=>c.rank===1 && c.suit!=="JOKER");
  if(aceIdx>=0 && !p.ships.some(s=>s.flagship)){
    state.pending={type:"crown",cardIdx:aceIdx};
    const best = p.ships.filter(s=>s.alive).sort((a,b)=>{
      const A = b.engine + b.hull + (b.shieldActive?b.shieldRating:0);
      const B = a.engine + a.hull + (a.shieldActive?a.shieldRating:0);
      return A-B;
    })[0];
    applyCrown(best.id); return;
  }

  const enemyFlag = o.ships.find(s=>s.flagship && s.alive);
  const K = p.hand.findIndex(c=>c.suit==="S"&&c.rank===13);
  if(K>=0){
    const lethal = o.ships.find(s=>s.alive && s.hull<=7) || enemyFlag;
    if(lethal){ state.pending={type:"special",cardIdx:K,card:p.hand[K]}; applySpecialOn(lethal.id); return; }
  }
  const J = p.hand.findIndex(c=>c.suit==="S"&&c.rank===11);
  if(J>=0){
    const lethal3 = o.ships.find(s=>s.alive && s.hull<=3) || (enemyFlag && enemyFlag.hull<=3 ? enemyFlag : null);
    if(lethal3){ state.pending={type:"special",cardIdx:J,card:p.hand[J]}; applySpecialOn(lethal3.id); return; }
  }

  const sp = p.hand.filter(c=>c.suit==="S" && c.rank>=2 && c.rank<=10).sort((a,b)=>a.rank-b.rank)[0];
  if(sp){
    const fit = p.ships.filter(s=>s.alive && sp.rank<=s.engine).sort((a,b)=>shipDamage(a)-shipDamage(b))[0];
    if(fit){
      state.phase="build_pick"; state.pending={type:"build",firstIdx:null,selectedIdx:null,pairIdx:null};
      handleBuildSelectCard(p.hand.indexOf(sp)); applyBuildToShip(fit.id); return;
    }
  }
  if(sp){
    const need = sp.rank;
    const clubUp = p.hand.filter(c=>c.suit==="C").sort((a,b)=>b.rank-a.rank)[0];
    const tgt = p.ships.filter(s=>s.alive).sort((a,b)=>a.engine-b.engine)[0];
    if(clubUp && tgt && tgt.engine<need){
      state.phase="build_pick"; state.pending={type:"build",firstIdx:null,selectedIdx:null,pairIdx:null};
      handleBuildSelectCard(p.hand.indexOf(clubUp)); applyBuildToShip(tgt.id); return;
    }
  }
  const club = p.hand.find(c=>c.suit==="C"), heart = p.hand.find(c=>c.suit==="H");
  if(club && heart){
    const aliveCount = p.ships.filter(s=>s.alive).length;
    const canLaunch = (aliveCount < state.maxFleet) || p.ships.some(s=>!s.alive);
    if(canLaunch){
      state.phase="build_pick"; state.pending={type:"build",firstIdx:null,selectedIdx:null,pairIdx:null};
      handleBuildSelectCard(p.hand.indexOf(club));
      handleBuildSelectCard(p.hand.indexOf(heart));
      confirmLaunch(); return;
    }
  }
  const heartUp = p.hand.filter(c=>c.suit==="H").sort((a,b)=>a.rank-b.rank)[0];
  if(heartUp){
    const s = p.ships.filter(s=>s.alive).sort((a,b)=>{
      const A = (a.hull + (a.shieldActive?a.shieldRating:0));
      const B = (b.hull + (b.shieldActive?b.shieldRating:0));
      return A-B;
    })[0];
    state.phase="build_pick"; state.pending={type:"build",firstIdx:null,selectedIdx:null,pairIdx:null};
    handleBuildSelectCard(p.hand.indexOf(heartUp)); applyBuildToShip(s.id); return;
  }
  const diam = p.hand.filter(c=>c.suit==="D").sort((a,b)=>b.rank-a.rank)[0];
  if(diam){
    const s = p.ships.filter(s=>s.alive).sort((a,b)=>a.shieldRating - b.shieldRating)[0];
    state.phase="build_pick"; state.pending={type:"build",firstIdx:null,selectedIdx:null,pairIdx:null};
    handleBuildSelectCard(p.hand.indexOf(diam)); applyBuildToShip(s.id); return;
  }
  const jok = p.hand.findIndex(c=>c.suit==="JOKER");
  const gun = opp().ships.filter(s=>s.alive && shipDamage(s)>0)
                .sort((a,b)=> (shipDamage(b) - shipDamage(a)) || ((b.flagship?1:0)-(a.flagship?1:0)) )[0];
  if(jok>=0 && gun){ state.pending={type:"special",cardIdx:jok,card:p.hand[jok]}; applySpecialOn(gun.id); return; }

  const atk = p.ships.filter(s=>s.alive && shipDamage(s)>0).sort((a,b)=>shipDamage(b)-shipDamage(a))[0];
  let tar = enemyFlag && enemyFlag.alive ? enemyFlag : weakestEnemyShip(p.id);
  if(atk && tar){ state.phase="attack_select_target"; state.pending={type:"attack",attackerId:atk.id}; performAttackOn(tar.id); return; }

  endTurn();
}

/* ================= Rendering ================= */
function setHint(t){ $("actionHint").textContent=t; }
function setSelected(t){ $("selectedInfo").textContent=t||"—"; }

function render(){
  const meColor = me().color;
  const col = $("controlsCol");
  col.classList.toggle("controls-p1", meColor==="p1");
  col.classList.toggle("controls-p2", meColor==="p2");
  $("turnPill").innerHTML = `Turn: <span class="${meColor}">${me().name}</span>`;
  const handDiv = $("hand");
  handDiv.classList.toggle("p1", meColor==="p1");
  handDiv.classList.toggle("p2", meColor==="p2");
  $("deckCount").textContent = state.deck.length;
  $("handCount").textContent = me().hand.length;

  const b = $("board"); b.innerHTML="";
  state.players.forEach(p=>{
    const side = document.createElement("div"); side.className="side";
    side.innerHTML = `<div><strong class="${p.color}">${p.name}</strong></div>`;
    const grid = document.createElement("div"); grid.className="ships";

    const highlightMap = computeShipHighlights(p.id);

    p.ships.forEach(s=>{
      const d = document.createElement("div"); d.className="ship"+(s.alive?"":" dead"); d.dataset.sid = s.id;
      if(highlightMap[s.id]) d.classList.add("hl");

      const role = roleOf(s);
      const dmg = shipDamage(s);
      const wlist = usableWeapons(s).sort((a,b)=>b-a);
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
        const phase = state.phase;
        if((phase==="build_target") && p.id===me().id){ applyBuildToShip(s.id); }
        else if(phase==="attack_select_attacker" && p.id===me().id){ selectAttacker(s.id); }
        else if(phase==="attack_select_target" && p.id===opp().id){ performAttackOn(s.id); }
        else if(phase==="crown_select_ship" && p.id===me().id){ applyCrown(s.id); }
        else if(phase==="special_target"){ applySpecialOn(s.id); }
        else setSelected(`Ship • ${s.name} — E:${s.engine} H:${s.hull} Sh:${s.shieldActive? s.shieldRating:0} | Role:${role} | Dmg:${dmg}`);
      });

      grid.appendChild(d);
    });

    side.appendChild(grid); b.appendChild(side);
  });

  // Hand
  const hand = $("hand"); hand.innerHTML="";
  const p = me();

  p.hand.forEach((c,idx)=>{
    const el=document.createElement("div"); el.className="card "+({C:"c",H:"h",D:"d",S:"s"}[c.suit]||"");
    el.textContent=lbl(c);

    // Highlight the chosen card during build_target
    if(state.phase==="build_target" && state.pending?.selectedIdx===idx) el.classList.add("sel");
    // While launching, disable hand (except maybe undo)
    if(state.phase==="special_target" || state.phase==="launch_pair") el.classList.add("disabled");

    el.addEventListener("click", ()=>{
      if(state.phase==="build_pick" || state.phase==="build_target"){ handleBuildSelectCard(idx); }
      else { setSelected(`Card • ${lbl(c)}`); }
    });
    hand.appendChild(el);
  });

  const used = state.turnActionUsed;
  const launching = (state.phase==="launch_pair");

  $("btnConfirmLaunch").style.display = launching ? "inline-block" : "none";
  $("btnBuild").disabled  = used || (!["idle","build_pick","build_target","launch_pair"].includes(state.phase));
  $("btnAttack").disabled = used || (state.phase!=="idle");
  $("btnCrown").disabled  = used || (state.phase!=="idle");
  $("onceNote").classList.toggle("used", used);

  $("deckCount").textContent = state.deck.length;
  $("handCount").textContent = me().hand.length;
}

function computeShipHighlights(ownerId){
  const map = {};
  const phase = state.phase, pend=state.pending;

  // Highlight own ships for single-card installs (build_target)
  if(phase==="build_target" && pend?.selectedIdx!=null && ownerId===me().id){
    const card = me().hand[pend.selectedIdx];
    if(card){
      for(const s of state.players[ownerId].ships){
        if(canApplyCardToShip(card, s, ownerId)) map[s.id]=true;
      }
    }
  }

  if(phase==="attack_select_attacker" && ownerId===me().id){
    for(const s of state.players[ownerId].ships){ if(s.alive && shipDamage(s)>0) map[s.id]=true; }
  }
  if(phase==="attack_select_target" && ownerId===opp().id){
    for(const s of state.players[ownerId].ships){ if(s.alive) map[s.id]=true; }
  }
  if(phase==="crown_select_ship" && ownerId===me().id){
    for(const s of state.players[ownerId].ships){ if(s.alive) map[s.id]=true; }
  }
  if(phase==="special_target" && pend?.card){
    for(const s of state.players[ownerId].ships){
      if(ownerId===me().id && pend.card.rank===12 && pend.card.suit==="S"){ // Q♠ reflect → my side only
        if(s.alive) map[s.id]=true;
      }
      if(ownerId===opp().id && pend.card.suit!=="JOKER" ? pend.card.rank!==12 : true){
        if(s.alive) map[s.id]=true; // J/K/Joker target any enemy alive (Joker requires weapons check on click)
      }
    }
  }
  return map;
}

function renderLog(){
  const el=$("log");
  el.innerHTML = state.log.map(l=>`<div class="${l.cls||''}">${l.msg}</div>`).join("");
}

/* ================= Wiring ================= */
$("btnBuild").addEventListener("click", ()=>{ beginBuild(); });
$("btnAttack").addEventListener("click", ()=>{ beginAttack(); });
$("btnCrown").addEventListener("click", ()=>{ beginCrown(); });
$("btnUndo").addEventListener("click", ()=>{ undo(); });
$("btnEndTurn").addEventListener("click", ()=>{ endTurn(); });
$("btnNewGame").addEventListener("click", ()=>{ initGame(); });
$("btnConfirmLaunch").addEventListener("click", ()=>{ confirmLaunch(); });

/* ================= Start ================= */
initGame();