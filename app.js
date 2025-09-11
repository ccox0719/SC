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
  phase: "idle", // build_select_card/build_select_ship/attack_select_attacker/attack_select_target/crown_select_ship/special_target/launch_pair
  pending: null,
  history: [],
  turnActionUsed: false,   // cleaned: set ONLY when an action completes
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
  if(state.history.length>60) state.history.shift();
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
  if(ship.weaponsInactiveTurns>0) return []; // Joker effect
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

/* =========== Shields: active/inactive with cooldown reactivation =========== */
/* Each ship has:
   - shieldRating: number (their ♦ rating)
   - shieldActive: boolean
   - shieldCooldown: turns remaining before reactivating (owner-turns)
   On damage: if shieldActive and any damage is applied, shield absorbs up to rating (once),
   then shieldActive=false and shieldCooldown=1. At start of that ship owner’s turn,
   cooldown--, and when 0 -> shieldActive=true again.
*/
function applyDamage(target, amount, {bypassShields=false}={}){
  let dealt = 0;
  if(!bypassShields && target.shieldActive && target.shieldRating>0 && amount>0){
    const absorbed = Math.min(amount, target.shieldRating);
    amount -= absorbed; dealt += absorbed;
    // deactivate shield for 1 owner-turn
    target.shieldActive = false;
    target.shieldCooldown = 1;
    // pulse UI
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
  // HP = Hull + (active shield rating if active, else 0) to match “value on table” tiebreak
  return sum(p.ships.filter(s=>s.alive).map(s=> s.hull + (s.shieldActive ? s.shieldRating : 0)));
}
function flagshipDestroyed(p){ return p.ships.some(s=>s.flagship) && !p.ships.some(s=>s.flagship && s.alive); }
function weakestEnemyShip(pid){
  const opp = state.players[1-pid];
  const alive = opp.ships.filter(s=>s.alive);
  alive.sort((a,b)=>(a.hull+(a.shieldActive? a.shieldRating:0))-(b.hull+(b.shieldActive? b.shieldRating:0)) || a.engine-b.engine);
  return alive[0] || null;
}

/* ================= Shields & Joker Turn Ticks ================= */
function startOfOwnerTurnMaintenance(p){
  for(const s of p.ships){
    // shield cooldown
    if(s.alive && s.shieldCooldown>0){
      s.shieldCooldown -= 1;
      if(s.shieldCooldown===0) s.shieldActive = true;
    }
    // joker weapons inactive
    if(s.alive && s.weaponsInactiveTurns>0){
      s.weaponsInactiveTurns -= 1;
    }
  }
}

/* ================= Init ================= */
function initGame(){
  state.deck = makeDeck();

  // starters with Shield ratings (active at start)
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
  state.players[0].drewTwo = true; // only P2 uses the flag
  state.players[1].drewTwo = false;

  state.log = [];
  state.phase = "idle";
  state.pending = null;
  state.history = [];
  state.turnActionUsed = false;

  log(`Game started. Player 1 begins. Player 2 will draw 2 on their first turn.`);
  startOfTurnDraw(state.players[0]); // P1 draws 1 at start
  render();
}

/* ================= Turn / Flow ================= */
function startOfTurnDraw(p){
  // owner maintenance first
  startOfOwnerTurnMaintenance(p);
  // draw
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
  // deck-out check
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
  state.turnActionUsed = false; // reset action budget — FIX for phantom grey-outs

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
function beginBuild(){ if(actionGate()) return; state.phase="build_select_card"; state.pending={type:"build", selectedCards:[]}; setHint("Build: select a card from your hand (you may pick one ♣ and one ♥ together to launch a new ship)."); render(); }
function beginAttack(){ if(actionGate()) return; state.phase="attack_select_attacker"; state.pending={type:"attack"}; setHint("Attack: select your attacking ship (must have weapons)."); render(); }
function beginCrown(){
  if(actionGate()) return;
  const p = me();
  const idx = p.hand.findIndex(c=>c.rank===1 && c.suit!=="JOKER");
  if(idx<0){ setHint("You have no Ace."); return; }
  state.phase="crown_select_ship"; state.pending={type:"crown", cardIdx:idx};
  setHint("Select a ship to crown (Engine becomes at least 5)."); render();
}
function confirmLaunch(){
  const p = me();
  const pend = state.pending;
  if(state.phase!=="launch_pair" || !pend?.selectedCards || pend.selectedCards.length!==2) return;

  snapshot();

  const [a,b] = pend.selectedCards;
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

  // remove the two cards (highest index first)
  [a,b].sort((x,y)=>y-x).forEach(i=>p.hand.splice(i,1));

  log(`${p.name} launches a new ship (E:${club.rank} H:${heart.rank}).`,"good");
  state.phase="idle"; state.pending=null; markActionUsed(); render(); maybeRunAI();
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

/* ===== Build selection & launch pair ===== */
function handleBuildSelectCard(cardIdx){
  const p = me();
  const card = p.hand[cardIdx];
  if(!card) return;

  // specials & joker (one action)
  if(card.suit==="JOKER" || (card.suit==="S" && [11,12,13].includes(card.rank))){
    state.phase="special_target"; state.pending={type:"special", cardIdx, card};
    if(card.suit==="JOKER") setHint("Joker: select an enemy ship with weapons (they go inactive for 1 turn).");
    else if(card.rank===11) setHint("J♠: select any enemy ship (3 Hull, bypass Shields).");
    else if(card.rank===12) setHint("Q♠: select your ship for reflect (≤5 on next attack).");
    else if(card.rank===13) setHint("K♠: select any enemy ship (7 Hull, bypass Shields).");
    render();
    return;
  }

  // try pair-launch (♣ + ♥)
  if(state.pending?.type==="build"){
    const sel = state.pending.selectedCards;
    if(sel.length===0){
      sel.push(cardIdx);
      setHint(`Selected ${lbl(card)}. Pick one ${card.suit==="C"?"♥":"♣"} to LAUNCH a new ship — or click a highlighted ship to install this ${lbl(card)}.`);
      render();
      return;
    }else if(sel.length===1){
      const first = p.hand[sel[0]];
      const suits = [first.suit, card.suit].sort().join("");
      if(suits==="CH"){ // valid pair
        sel.push(cardIdx);
        state.phase = "launch_pair";
        setHint("Launch ready: click **Confirm Launch** (or click a valid ship to cancel and install single card).");
        render();
        return;
      }else{
        // replace selection with this card
        state.pending.selectedCards = [cardIdx];
        setHint(`Selected ${lbl(card)}. Pick the complementary ${card.suit==="C"?"♥":"♣"} to LAUNCH — or click a highlighted ship to install.`);
        render();
        return;
      }
    }
  }

  // default single-card install
  state.phase="build_select_ship";
  state.pending={type:"build", cardIdx, card, selectedCards:[]};

  // compute valid targets and explain if none
  const targets = me().ships.filter(s=>canApplyCardToShip(card, s, me().id));
  if(targets.length===0){
    if(card.suit==="S"){
      const maxE = Math.max(...me().ships.map(s=>s.engine));
      setHint(`No valid targets for ${lbl(card)}. Your highest Engine is ${maxE}. Either upgrade ♣ first or play a different card.`);
    }else if(card.suit==="C" || card.suit==="H" || card.suit==="D"){
      setHint(`No valid targets: you can only build on your **own living** ships. (Destroyed ships can only be replaced by launching ♣+♥.)`);
    }else{
      setHint(`No valid targets for ${lbl(card)}.`);
    }
  }else{
    setHint(`Build: select a **highlighted** ship to apply ${lbl(card)}.`);
  }
  render();
}

function canApplyCardToShip(card, ship, ownerId){
  if(!ship.alive) return false;
  if(state.phase==="build_select_ship"){
    if(me().id!==ownerId) return false;
    if(card.suit==="C") return true;
    if(card.suit==="H") return true;
    if(card.suit==="D") return true; // set shield rating; reactivates immediately
    if(card.suit==="S" && card.rank>=2 && card.rank<=10) return card.rank <= ship.engine;
    return false;
  }
  if(state.phase==="special_target"){
    const mine = ownerId===me().id;
    if(card.suit==="JOKER"){ return !mine && ship.alive && (ship.weapons.length>0); }
    if(card.suit==="S" && card.rank===11){ return !mine && ship.alive; } // J♠
    if(card.suit==="S" && card.rank===12){ return mine && ship.alive; }  // Q♠
    if(card.suit==="S" && card.rank===13){ return !mine && ship.alive; } // K♠
  }
  if(state.phase==="launch_pair"){
    // show “empty” or destroyed slots on owner side — we’ll click on the side panel, not a specific slot
    return false;
  }
  return false;
}

function applyBuildToShip(shipId){
  snapshot();
  const p = me(); const pend = state.pending; if(!pend) return;

  // LAUNCH with pair (♣ + ♥)
  if(state.phase==="launch_pair" && pend.selectedCards?.length===2){
    const idxA = pend.selectedCards[0], idxB = pend.selectedCards[1];
    const cA = p.hand[idxA], cB = p.hand[idxB];
    const club = (cA.suit==="C") ? cA : cB;
    const heart = (cB.suit==="H") ? cB : cA;
    if(!(club && heart)) { state.history.pop(); return; }

    // enforce fleet cap and replacement
    const aliveCount = p.ships.filter(s=>s.alive).length;
    if(aliveCount >= state.maxFleet && !p.ships.some(s=>!s.alive)){
      setHint(`Fleet is full (cap ${state.maxFleet}). Destroy a ship first or upgrade instead.`);
      state.history.pop(); return;
    }
    // create new ship
    const nid = `${p.id===0?"p1":"p2"}n${Date.now()%100000}`;
    const newShip = {
      id:nid, name:`${p.name} New Ship`, engine:club.rank, hull:heart.rank,
      shieldRating:0, shieldActive:false, shieldCooldown:0,
      weapons:[], weaponsInactiveTurns:0, alive:true, flagship:false, reflect:false
    };
    p.ships.push(newShip);
    // remove cards (higher index first)
    const rm = [idxA, idxB].sort((a,b)=>b-a);
    for(const i of rm){ p.hand.splice(i,1); }

    log(`${p.name} launches a new ship (E:${club.rank} H:${heart.rank}).`,"good");
    state.phase="idle"; state.pending=null; markActionUsed(); render(); maybeRunAI();
    return;
  }

  // SINGLE-CARD BUILD
  const card = p.hand[pend.cardIdx]; if(!card) { state.history.pop(); return; }
  const ship = p.ships.find(s=>s.id===shipId); if(!ship) { state.history.pop(); return; }

  if(card.suit==="C"){ ship.engine=Math.max(ship.engine, card.rank); p.hand.splice(pend.cardIdx,1); log(`${p.name} upgrades Engine on ${ship.name} → ${ship.engine}.`); }
  else if(card.suit==="H"){ ship.hull+=card.rank; p.hand.splice(pend.cardIdx,1); log(`${p.name} adds ${card.rank} Hull to ${ship.name}.`); }
  else if(card.suit==="D"){
    ship.shieldRating = Math.max(ship.shieldRating, card.rank);
    ship.shieldActive = true; ship.shieldCooldown = 0; // re-activate on install
    p.hand.splice(pend.cardIdx,1);
    log(`${p.name} sets Shield ${ship.shieldRating} on ${ship.name} (active).`);
  }
  else if(card.suit==="S" && card.rank>=2 && card.rank<=10){
    if(card.rank>ship.engine){ setHint(`Engine ${ship.engine} too low for weapon ${card.rank}.`); state.history.pop(); return; }
    ship.weapons.push(card.rank);
    p.hand.splice(pend.cardIdx,1);
    log(`${p.name} installs weapon ${card.rank}♠ on ${ship.name}.`);
  }else{
    state.history.pop(); return;
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
    tgt.weaponsInactiveTurns = Math.max(tgt.weaponsInactiveTurns, 1); // weapons offline for 1 enemy-turn
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
function maybeRunAI(){
  const aiOn = $("aiToggle").checked;
  if(!aiOn) return;
  if(state.turn!==1) return;
  setTimeout(aiTakeTurn, 180);
}
function aiTakeTurn(){
  if($("btnEndTurn").disabled) return;
  if(state.turnActionUsed){ endTurn(); return; }

  const diff = $("aiDifficulty").value;
  if(diff==="easy") return aiEasy();
  if(diff==="hard") return aiHard();
  return aiNormal();
}

function aiEasy(){
  const p = me(), o = opp();

  // random choice among: crown(if ace & no flag), special, build, attack
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
  // try random build: spade fit or engine/hull/shield
  const sp = p.hand.filter(c=>c.suit==="S" && c.rank>=2 && c.rank<=10);
  if(sp.length) choices.push(()=>{
    const c = sp[Math.floor(Math.random()*sp.length)];
    const fit = p.ships.find(s=>s.alive && c.rank<=s.engine) || p.ships[0];
    state.phase="build_select_ship"; state.pending={type:"build",cardIdx:p.hand.indexOf(c),card:c}; applyBuildToShip(fit.id);
  });
  const club = p.hand.find(c=>c.suit==="C");
  const heart = p.hand.find(c=>c.suit==="H");
  if(club && heart) choices.push(()=>{ // launch
    state.pending={type:"build",selectedCards:[p.hand.indexOf(club), p.hand.indexOf(heart)]};
    state.phase="launch_pair"; // click any of my ships to trigger handler
    // we don't need a shipId for launching; just call applyBuildToShip with own first ship id
    applyBuildToShip(p.ships[0].id);
  });
  const atk = p.ships.find(s=>s.alive && shipDamage(s)>0);
  const tar = opp().ships.find(s=>s.alive);
  if(atk && tar) choices.push(()=>{ state.phase="attack_select_target"; state.pending={type:"attack",attackerId:atk.id}; performAttackOn(tar.id); });

  if(!choices.length){ endTurn(); return; }
  choices[Math.floor(Math.random()*choices.length)]();
}

function aiNormal(){
  const p = me(), o = opp();
  // Crown if Ace & no flagship
  const aceIdx = p.hand.findIndex(c=>c.rank===1 && c.suit!=="JOKER");
  if(aceIdx>=0 && !p.ships.some(s=>s.flagship)){
    state.pending={type:"crown",cardIdx:aceIdx};
    const best = p.ships.filter(s=>s.alive).sort((a,b)=>(b.engine+b.hull+(b.shieldActive?b.shieldRating:0))-(a.engine+a.hull+(a.shieldActive?a.shieldRating:0)))[0];
    applyCrown(best.id); return;
  }

  // Lethal specials
  const K = p.hand.findIndex(c=>c.suit==="S"&&c.rank===13);
  let target = weakestEnemyShip(p.id);
  if(K>=0 && target && target.hull<=7){ state.pending={type:"special",cardIdx:K,card:p.hand[K]}; applySpecialOn(target.id); return; }
  const J = p.hand.findIndex(c=>c.suit==="S"&&c.rank===11);
  target = weakestEnemyShip(p.id);
  if(J>=0 && target && target.hull<=3){ state.pending={type:"special",cardIdx:J,card:p.hand[J]}; applySpecialOn(target.id); return; }

  // Install lowest spade that fits
  const sp = p.hand.filter(c=>c.suit==="S" && c.rank>=2 && c.rank<=10).sort((a,b)=>a.rank-b.rank)[0];
  if(sp){
    const fit = p.ships.filter(s=>s.alive && sp.rank<=s.engine).sort((a,b)=>shipDamage(a)-shipDamage(b))[0];
    if(fit){ state.phase="build_select_ship"; state.pending={type:"build",cardIdx:p.hand.indexOf(sp),card:sp}; applyBuildToShip(fit.id); return; }
  }
  // Launch if club+heart (replace destroyed or add if space)
  const club = p.hand.find(c=>c.suit==="C"), heart = p.hand.find(c=>c.suit==="H");
  if(club && heart){
    const aliveCount = p.ships.filter(s=>s.alive).length;
    if(aliveCount < state.maxFleet || p.ships.some(s=>!s.alive)){
      state.pending={type:"build",selectedCards:[p.hand.indexOf(club), p.hand.indexOf(heart)]}; state.phase="launch_pair"; applyBuildToShip(p.ships[0].id); return;
    }
  }
  // Engine toward known spade
  if(sp){
    const need = sp.rank;
    const clubUp = p.hand.filter(c=>c.suit==="C").sort((a,b)=>b.rank-a.rank)[0];
    const tgt = p.ships.filter(s=>s.alive).sort((a,b)=>a.engine-b.engine)[0];
    if(clubUp && tgt && tgt.engine<need){ state.phase="build_select_ship"; state.pending={type:"build",cardIdx:p.hand.indexOf(clubUp),card:clubUp}; applyBuildToShip(tgt.id); return; }
  }
  // Hull weakest
  const heartUp = p.hand.filter(c=>c.suit==="H").sort((a,b)=>a.rank-b.rank)[0];
  if(heartUp){
    const s = p.ships.filter(s=>s.alive).sort((a,b)=>(a.hull+(a.shieldActive?a.shieldRating:0))-(b.hull+(b.shieldActive?b.shieldRating:0)))[0];
    state.phase="build_select_ship"; state.pending={type:"build",cardIdx:p.hand.indexOf(heartUp),card:heartUp}; applyBuildToShip(s.id); return;
  }
  // Shield lowest rating (also reactivates)
  const diam = p.hand.filter(c=>c.suit==="D").sort((a,b)=>b.rank-a.rank)[0];
  if(diam){
    const s = p.ships.filter(s=>s.alive).sort((a,b)=>(a.shieldRating - b.shieldRating))[0];
    state.phase="build_select_ship"; state.pending={type:"build",cardIdx:p.hand.indexOf(diam),card:diam}; applyBuildToShip(s.id); return;
  }
  // Joker biggest enemy gun for tempo
  const jok = p.hand.findIndex(c=>c.suit==="JOKER");
  const gun = opp().ships.filter(s=>s.alive && shipDamage(s)>0).sort((a,b)=>shipDamage(b)-shipDamage(a))[0];
  if(jok>=0 && gun){ state.pending={type:"special",cardIdx:jok,card:p.hand[jok]}; applySpecialOn(gun.id); return; }

  // Attack: best gun into weakest
  const atk = p.ships.filter(s=>s.alive && shipDamage(s)>0).sort((a,b)=>shipDamage(b)-shipDamage(a))[0];
  const tar = weakestEnemyShip(p.id);
  if(atk && tar){ state.phase="attack_select_target"; state.pending={type:"attack",attackerId:atk.id}; performAttackOn(tar.id); return; }

  endTurn();
}

function aiHard(){
  const p = me(), o = opp();

  // 1) Crown if no flag & Ace
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

  // 2) Kill shots & Flagship focus
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

  // 3) Build toward highest DPS this turn/next: fit spade -> engine -> launch -> hull -> shield -> joker
  const sp = p.hand.filter(c=>c.suit==="S" && c.rank>=2 && c.rank<=10).sort((a,b)=>a.rank-b.rank)[0];
  if(sp){
    const fit = p.ships.filter(s=>s.alive && sp.rank<=s.engine).sort((a,b)=>shipDamage(a)-shipDamage(b))[0];
    if(fit){ state.phase="build_select_ship"; state.pending={type:"build",cardIdx:p.hand.indexOf(sp),card:sp}; applyBuildToShip(fit.id); return; }
  }
  if(sp){
    const need = sp.rank;
    const clubUp = p.hand.filter(c=>c.suit==="C").sort((a,b)=>b.rank-a.rank)[0];
    const tgt = p.ships.filter(s=>s.alive).sort((a,b)=>a.engine-b.engine)[0];
    if(clubUp && tgt && tgt.engine<need){ state.phase="build_select_ship"; state.pending={type:"build",cardIdx:p.hand.indexOf(clubUp),card:clubUp}; applyBuildToShip(tgt.id); return; }
  }
  const club = p.hand.find(c=>c.suit==="C"), heart = p.hand.find(c=>c.suit==="H");
  if(club && heart){
    const aliveCount = p.ships.filter(s=>s.alive).length;
    const canLaunch = (aliveCount < state.maxFleet) || p.ships.some(s=>!s.alive);
    if(canLaunch){
      state.pending={type:"build",selectedCards:[p.hand.indexOf(club), p.hand.indexOf(heart)]}; state.phase="launch_pair"; applyBuildToShip(p.ships[0].id); return;
    }
  }
  const heartUp = p.hand.filter(c=>c.suit==="H").sort((a,b)=>a.rank-b.rank)[0];
  if(heartUp){
    const s = p.ships.filter(s=>s.alive).sort((a,b)=>{
      const A = (a.hull + (a.shieldActive?a.shieldRating:0));
      const B = (b.hull + (b.shieldActive?b.shieldRating:0));
      return A-B;
    })[0];
    state.phase="build_select_ship"; state.pending={type:"build",cardIdx:p.hand.indexOf(heartUp),card:heartUp}; applyBuildToShip(s.id); return;
  }
  const diam = p.hand.filter(c=>c.suit==="D").sort((a,b)=>b.rank-a.rank)[0];
  if(diam){
    const s = p.ships.filter(s=>s.alive).sort((a,b)=>a.shieldRating - b.shieldRating)[0];
    state.phase="build_select_ship"; state.pending={type:"build",cardIdx:p.hand.indexOf(diam),card:diam}; applyBuildToShip(s.id); return;
  }
  const jok = p.hand.findIndex(c=>c.suit==="JOKER");
  const gun = opp().ships.filter(s=>s.alive && shipDamage(s)>0)
                .sort((a,b)=> (shipDamage(b) - shipDamage(a)) || ((b.flagship?1:0)-(a.flagship?1:0)) )[0];
  if(jok>=0 && gun){ state.pending={type:"special",cardIdx:jok,card:p.hand[jok]}; applySpecialOn(gun.id); return; }

  // 4) Attack: prefer hitting enemy Flagship; else weakest effective
  const atk = p.ships.filter(s=>s.alive && shipDamage(s)>0).sort((a,b)=>shipDamage(b)-shipDamage(a))[0];
  let tar = enemyFlag && enemyFlag.alive ? enemyFlag : weakestEnemyShip(p.id);
  if(atk && tar){ state.phase="attack_select_target"; state.pending={type:"attack",attackerId:atk.id}; performAttackOn(tar.id); return; }

  endTurn();
}

/* ================= Rendering ================= */
function setHint(t){ $("actionHint").textContent=t; }
function setSelected(t){ $("selectedInfo").textContent=t||"—"; }

function render(){
  // color-code controls & hand by turn
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

  // Battlefield
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
        if(phase==="build_select_ship"){ applyBuildToShip(s.id); }
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
  // Build pair selection: show selected halo
  const sel = (state.pending?.type==="build" && state.pending.selectedCards) ? new Set(state.pending.selectedCards) : new Set();

  p.hand.forEach((c,idx)=>{
    const el=document.createElement("div"); el.className="card "+({C:"c",H:"h",D:"d",S:"s"}[c.suit]||"");
    el.textContent=lbl(c);
    if(sel.has(idx)) el.classList.add("sel");
    if(state.phase==="build_select_ship" || state.phase==="special_target" || state.phase==="launch_pair") el.classList.add("disabled");
    el.addEventListener("click", ()=>{
      if(state.phase==="build_select_card"){ handleBuildSelectCard(idx); }
      else { setSelected(`Card • ${lbl(c)}`); }
    });
    hand.appendChild(el);
  });

  // Buttons (disabled after action)
  const used = state.turnActionUsed;
  $("btnBuild").disabled = (state.phase!=="idle" && state.phase!=="build_select_card") || used;
  $("btnAttack").disabled = (state.phase!=="idle") || used;
  $("btnCrown").disabled = (state.phase!=="idle") || used;
  $("onceNote").classList.toggle("used", used);
  $("deckCount").textContent = state.deck.length;
  $("handCount").textContent = me().hand.length;
}

function computeShipHighlights(ownerId){
  const map = {};
  const phase = state.phase, pend=state.pending;

  if(phase==="build_select_ship" && pend?.card){
    for(const s of state.players[ownerId].ships){
      if(canApplyCardToShip(pend.card, s, ownerId)) map[s.id]=true;
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
      if(canApplyCardToShip(pend.card, s, ownerId)) map[s.id]=true;
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

/* ================= Start ================= */
initGame();