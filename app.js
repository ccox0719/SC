/*==========================================================
  Space Fleet Battle — Clean Restart (single-file engine+UI)
  - Full rules engine
  - Hotseat 2P + optional AI (Easy)
  - Undo, New Game, Deck-out
==========================================================*/

const SUITS = ["♣","♥","♦","♠"];
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const MAX_FLEET = 3;

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

/* -----------------------
   Game State
------------------------*/
const S = {
  deck: [],
  discard: [],
  players: [
    { id:0, name:"Player 1", hand:[], ships:[], isAI:false },
    { id:1, name:"Player 2", hand:[], ships:[], isAI:false }
  ],
  turn: 0, // player index
  started:false,
  phase:"main",
  drawBoostP2:true, // P2 draws 2 on first turn
  history: [],
  ui:{
    selectedCard:null,  // {owner:0|1, idx}
    mode:null,          // "build"|"attack"|"crown"|"special"|"launch"
    pendingLaunch:{clubs:null, hearts:null},
    highlight:{ships:[], foeShips:[]}
  },
  flags:{
    deckOutChecked:false
  }
};

/* -----------------------
   Utilities
------------------------*/
function deep(o){ return JSON.parse(JSON.stringify(o)); }
function shuffle(a){
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}
function buildDeck(){
  const d=[];
  for(const s of SUITS){
    for(const r of RANKS){
      d.push({s,r});
    }
  }
  // + 2 Jokers (use r="Joker", s="★")
  d.push({s:"★", r:"Joker"});
  d.push({s:"★", r:"Joker"});
  return d;
}
function rankValue(r){
  if(r==="A") return 1;
  if(r==="J") return 11;
  if(r==="Q") return 12;
  if(r==="K") return 13;
  return Number(r);
}
function isWeaponCard(c){ return c.s==="♠" && ["2","3","4","5","6","7","8","9","10"].includes(c.r); }
function isRoyalSpade(c){ return c.s==="♠" && ["J","Q","K"].includes(c.r); }
function isAce(c){ return SUITS.includes(c.s) && c.r==="A"; }
function isJoker(c){ return c.r==="Joker"; }
function suitEmoji(s){ return s; }

/* -----------------------
   Ships / Stacks / Effects
------------------------*/
function newShip(name="Ship"){
  return {
    name,
    flagship:false,
    stacks:{ clubs:[], hearts:[], diamonds:[], spades:[] },
    stats:{ engine:0, hullMax:0, hull:0, shield:0 },
    shieldActive:false,
    shieldCooldown:0, // counts your own turns
    weaponsOffline:0, // counts your own turns
    tags:[]
  };
}

function suitKey(s){
  return s==="♣"?"clubs": s==="♥"?"hearts": s==="♦"?"diamonds": "spades";
}

function stackValue(cards){
  if(cards.length===0) return 0;
  let max = Math.max(...cards.map(c => rankValue(c.r)));
  // stacking rule: biggest rank +1 per extra
  return max + (cards.length-1);
}

function recalcShip(ship){
  ship.stats.engine = stackValue(ship.stacks.clubs);
  ship.stats.hullMax = stackValue(ship.stacks.hearts);
  // if hullMax increases, heal only the delta up to new max (no overheal above new max)
  if(ship.stats.hull === 0 && ship.stats.hullMax > 0 && ship.stacks.hearts.length===1){
    // initial install from 0
    ship.stats.hull = ship.stats.hullMax;
  } else {
    ship.stats.hull = Math.min(ship.stats.hull + Math.max(0, ship.stats.hullMax - ship.stats.hull), ship.stats.hullMax);
  }

  ship.stats.shield = stackValue(ship.stacks.diamonds);

  // weapons value = highest usable weapon +1 per extra weapon
  const weps = ship.stacks.spades.filter(isWeaponCard);
  const usable = weps.filter(w => rankValue(w.r) <= ship.stats.engine);
  if(usable.length === 0){
    ship.stats.weapons = 0;
  }else{
    const max = Math.max(...usable.map(w=>rankValue(w.r)));
    ship.stats.weapons = max + (usable.length-1);
  }
}

function startOfTurnMaintenance(p){
  for(const sh of S.players[p].ships){
    if(sh.shieldCooldown>0){
      sh.shieldCooldown--;
      if(sh.shieldCooldown===0){
        sh.shieldActive = true;
      }
    }
    if(sh.weaponsOffline>0){
      sh.weaponsOffline--;
      if(sh.weaponsOffline===0){
        sh.tags = sh.tags.filter(t => t!=="Weapons Offline");
      }
    }
  }
}

function destroyShip(pid, idx){
  const ship = S.players[pid].ships[idx];
  log(`${S.players[pid].name}'s ${ship.name} destroyed.`);
  S.players[pid].ships.splice(idx,1);
}

function totalHPWithShield(pid){
  // For deck-out: sum hull + active shield (living ships)
  return S.players[pid].ships.reduce((acc,sh)=>{
    const s = sh.shieldActive ? sh.stats.shield : 0;
    return acc + Math.max(0, sh.stats.hull) + s;
  },0);
}

/* -----------------------
   Turn / Deck
------------------------*/
function draw(pid, n=1){
  for(let i=0;i<n;i++){
    if(S.deck.length===0) break;
    S.players[pid].hand.push(S.deck.pop());
  }
}

function nextTurn(){
  S.turn = (S.turn+1) % 2;
  S.ui.mode = null;
  S.ui.selectedCard = null;
  S.ui.pendingLaunch = {clubs:null, hearts:null};
  S.ui.highlight = {ships:[], foeShips:[]};

  startOfTurnMaintenance(S.turn);

  // draw 1 (except P2 first turn = draw 2)
  if(S.drawBoostP2 && S.turn===1){
    draw(1,2);
    S.drawBoostP2 = false;
  } else {
    draw(S.turn,1);
  }

  checkDeckOutWin();
  render();
  if(current().isAI) setTimeout(aiAct, 300);
}

function current(){ return S.players[S.turn]; }
function foe(){ return S.players[(S.turn+1)%2]; }

/* -----------------------
   History (Undo)
------------------------*/
function pushHistory(){
  S.history.push(deep({
    deck:S.deck, discard:S.discard, players:S.players, turn:S.turn,
    started:S.started, phase:S.phase, drawBoostP2:S.drawBoostP2,
    ui:S.ui, flags:S.flags
  }));
  if(S.history.length>40) S.history.shift();
  $("#btnUndo").disabled = S.history.length===0;
}
function undo(){
  if(S.history.length===0) return;
  const snap = S.history.pop();
  Object.assign(S, deep(snap));
  $("#btnUndo").disabled = S.history.length===0;
  render();
}

/* -----------------------
   Setup / New Game
------------------------*/
function dealHands(){
  // P1:7, P2:6
  draw(0,7);
  draw(1,6);
  // Optional: guarantee an Ace — omitted by default for purity
}

function startGame(){
  S.deck = shuffle(buildDeck());
  S.discard = [];
  S.players[0].hand = [];
  S.players[1].hand = [];
  S.players[0].ships = [];
  S.players[1].ships = [];
  S.players[0].isAI = false;
  S.players[1].isAI = $("#aiEnabled").checked;

  S.turn = 0;
  S.started = true;
  S.phase = "main";
  S.drawBoostP2 = true;
  S.history.length = 0;
  S.flags.deckOutChecked = false;

  dealHands();
  // Start with 2 small ships each (empty hull until installed)
  S.players[0].ships.push(newShip("P1-Alpha"), newShip("P1-Beta"));
  S.players[1].ships.push(newShip("P2-Alpha"), newShip("P2-Beta"));

  render();
}

/* -----------------------
   Actions
------------------------*/
function canInstallWeaponOn(ship, card){
  if(!isWeaponCard(card)) return true; // non-weapon allowed
  const e = stackValue(ship.stacks.clubs);
  return rankValue(card.r) <= e;
}

function performBuild(cardIdx, shipIdx){
  const me = current();
  const c = me.hand[cardIdx];
  if(!c) return;

  pushHistory();

  const sk = suitKey(c.s);
  const ship = me.ships[shipIdx];

  if(c.s==="♠" && isRoyalSpade(c)){
    // build does not apply to royal spades — those are Specials
    S.history.pop(); // revert history push because invalid action
    return;
  }
  if(isJoker(c)){
    S.history.pop();
    return;
  }

  if(c.s==="♠" && !canInstallWeaponOn(ship, c)){
    hint("Weapon rank must be ≤ current Engine.");
    S.history.pop();
    return;
  }

  ship.stacks[sk].push(c);
  me.hand.splice(cardIdx,1);
  // Shields become active immediately on install, one-shot, then cooldown
  if(c.s==="♦") ship.shieldActive = true;

  recalcShip(ship);
  log(`${me.name} installs ${labelCard(c)} on ${ship.name}.`);
  finishAction();
}

function beginLaunch(){
  S.ui.mode = "launch";
  hint("Select a ♣ and a ♥ from your hand to queue a new ship.");
  render();
}

function cancelLaunch(){
  S.ui.pendingLaunch = {clubs:null, hearts:null};
  $("#pendingLaunch").classList.add("hidden");
  S.ui.mode = null;
  render();
}

function confirmLaunch(){
  const me = current();
  const {clubs, hearts} = S.ui.pendingLaunch;
  if(clubs==null || hearts==null){
    hint("Need one ♣ and one ♥ to launch.");
    return;
  }
  if(me.ships.length >= MAX_FLEET){
    hint(`Fleet cap reached (${MAX_FLEET}).`);
    return;
  }

  pushHistory();

  const c = me.hand[clubs];
  const h = me.hand[hearts];

  // Ensure order in indices for safe splice
  const first = Math.min(clubs, hearts);
  const second = Math.max(clubs, hearts);

  const ship = newShip(`P${me.id+1}-S${me.ships.length+1}`);
  ship.stacks.clubs.push(c);
  ship.stacks.hearts.push(h);
  recalcShip(ship);

  me.ships.push(ship);
  me.hand.splice(second,1);
  me.hand.splice(first,1);

  S.ui.pendingLaunch = {clubs:null, hearts:null};
  $("#pendingLaunch").classList.add("hidden");
  log(`${me.name} launches ${ship.name} (♣${ship.stats.engine}, ♥${ship.stats.hullMax}).`);
  finishAction();
}

function performAttack(attackerIdx, defenderPid, defenderIdx){
  const me = current();
  const atk = me.ships[attackerIdx];
  if(!atk) return;

  if(atk.weaponsOffline>0){
    hint("This ship's weapons are offline.");
    return;
  }

  // need usable weapons
  if(atk.stats.weapons<=0){
    hint("No usable weapons on that ship.");
    return;
  }

  pushHistory();

  // Damage = highest usable weapon +1 per extra weapon
  // +2 if Speed role (Engine > Hull)
  let dmg = atk.stats.weapons;
  if(atk.stats.engine > atk.stats.hullMax) dmg += 2;

  let target = S.players[defenderPid].ships[defenderIdx];
  let remaining = dmg;

  if(target.shieldActive){
    const absorb = Math.min(target.stats.shield, remaining);
    remaining -= absorb;
    target.shieldActive = false;
    target.shieldCooldown = 1; // reactivates after your next turn starts
  }

  if(remaining>0){
    target.stats.hull -= remaining;
  }

  log(`${me.name}'s ${atk.name} attacks ${S.players[defenderPid].name}'s ${target.name} for ${dmg} (${dmg-remaining} absorbed).`);

  if(target.stats.hull<=0){
    // destruction
    const wasFlag = target.flagship;
    destroyShip(defenderPid, defenderIdx);
    if(wasFlag) {
      // immediate win if all enemy flagships destroyed
      const foeFlags = S.players[(S.turn+1)%2].ships.some(s=>s.flagship);
      if(!foeFlags){
        endGame(`${me.name} wins: all enemy Flagships destroyed.`);
        return;
      }
    }
  }

  finishAction();
}

function performCrown(cardIdx, shipIdx){
  const me = current();
  const c = me.hand[cardIdx];
  if(!isAce(c)) return;

  pushHistory();

  const ship = me.ships[shipIdx];
  ship.flagship = true;

  // Engine is at least 5 under stacking rule
  // We can simulate adding "virtual" engine to bump to 5 if needed
  const eng = stackValue(ship.stacks.clubs);
  if(eng < 5){
    // Add phantom +X? Rule says "bump engine stack to reach 5 under stacking rule"
    // Implement by adding a crown-bonus tag that sets engine floor to 5
    ship.tags = ship.tags.filter(t=>!t.startsWith("Engine Floor"));
    ship.tags.push("Engine Floor 5");
  }

  me.hand.splice(cardIdx,1);
  recalcShip(ship);
  // Apply engine floor effect
  if(ship.stats.engine < 5) ship.stats.engine = 5;

  log(`${me.name} crowns ${ship.name}. It is now a Flagship (Engine ≥ 5).`);
  finishAction();
}

function performSpecial(cardIdx, targetPid, targetShipIdx, ownShipIdxForQ){
  const me = current();
  const card = me.hand[cardIdx];
  if(!card) return;

  if(isJoker(card)){
    // Joker: target enemy ship that has weapons → weapons offline 1 turn
    const target = S.players[targetPid].ships[targetShipIdx];
    if(!target){ hint("Select a valid enemy ship."); return; }

    // must have weapons stack (any)
    const hasWeapons = target.stacks.spades.some(isWeaponCard);
    if(!hasWeapons){ hint("Target must have weapons."); return; }

    pushHistory();
    target.weaponsOffline = Math.max(target.weaponsOffline, 1);
    if(!target.tags.includes("Weapons Offline")) target.tags.push("Weapons Offline");
    me.hand.splice(cardIdx,1);
    log(`${me.name} plays Joker: ${S.players[targetPid].name}'s ${target.name} weapons offline for 1 turn.`);
    return finishAction();
  }

  if(isRoyalSpade(card)){
    if(card.r==="J"){
      // J♠: Deal 3 Hull damage to any enemy ship (bypass shields)
      const target = S.players[targetPid].ships[targetShipIdx];
      if(!target){ hint("Select a valid enemy ship."); return; }
      pushHistory();
      target.stats.hull -= 3;
      log(`${me.name} plays J♠: ${target.name} takes 3 bypass.`);
      if(target.stats.hull<=0){
        const wasFlag = target.flagship;
        destroyShip(targetPid, targetShipIdx);
        if(wasFlag){
          const foeFlags = S.players[(S.turn+1)%2].ships.some(s=>s.flagship);
          if(!foeFlags){
            endGame(`${me.name} wins: all enemy Flagships destroyed.`);
            return;
          }
        }
      }
      me.hand.splice(cardIdx,1);
      return finishAction();
    }
    if(card.r==="K"){
      // K♠: Deal 7 Hull damage to any enemy ship (bypass shields)
      const target = S.players[targetPid].ships[targetShipIdx];
      if(!target){ hint("Select a valid enemy ship."); return; }
      pushHistory();
      target.stats.hull -= 7;
      log(`${me.name} plays K♠: ${target.name} takes 7 bypass.`);
      if(target.stats.hull<=0){
        const wasFlag = target.flagship;
        destroyShip(targetPid, targetShipIdx);
        if(wasFlag){
          const foeFlags = S.players[(S.turn+1)%2].ships.some(s=>s.flagship);
          if(!foeFlags){
            endGame(`${me.name} wins: all enemy Flagships destroyed.`);
            return;
          }
        }
      }
      me.hand.splice(cardIdx,1);
      return finishAction();
    }
    if(card.r==="Q"){
      // Q♠: Give one of your ships Reflect (blowback to self) up to 5
      // (Per your spec: “on its next attack, it takes reflected damage up to 5”)
      // Implement as a tag that triggers on its next attack resolution
      const own = current().ships[ownShipIdxForQ];
      if(!own){ hint("Select one of your ships for Q♠."); return; }
      pushHistory();
      own.tags.push("Reflect Self 5 (next attack)");
      me.hand.splice(cardIdx,1);
      log(`${me.name} plays Q♠: ${own.name} gains self-reflect (cap 5) on next attack.`);
      return finishAction();
    }
  }

  hint("Select a valid Special and target.");
}

/* Called after any single action has succeeded */
function finishAction(){
  // After a successful action, enable End Turn, disable other one-per-turn actions
  S.ui.mode = null;
  // Deck-out immediate win condition check triggered at end turn normally,
  // but do a quick pass in case game ended by destruction.
  render();
  $("#btnEnd").disabled = false;
  $("#btnBuild").disabled = true;
  $("#btnLaunch").disabled = true;
  $("#btnAttack").disabled = true;
  $("#btnCrown").disabled = true;
  $("#btnSpecial").disabled = true;
}

/* -----------------------
   End Turn / End Game
------------------------*/
function endTurn(){
  $("#btnEnd").disabled = true;
  nextTurn();
}

function endGame(msg){
  log(`🏁 ${msg}`);
  S.started=false;
  // lock buttons
  $$("#actions button").forEach(b=>b.disabled=true);
}

/* -----------------------
   Deck-out Tiebreak
------------------------*/
function checkDeckOutWin(){
  if(S.deck.length>0) return;
  if(S.flags.deckOutChecked) return;
  S.flags.deckOutChecked = true;

  const a = totalHPWithShield(0);
  const b = totalHPWithShield(1);
  if(a>b){ endGame(`Deck-out: ${S.players[0].name} wins on HP (${a} vs ${b}).`); return; }
  if(b>a){ endGame(`Deck-out: ${S.players[1].name} wins on HP (${b} vs ${a}).`); return; }

  // tie: sudden death – play continues without deck until a Flagship is destroyed
  log("Deck-out tie: sudden death — first Flagship destroyed loses.");
}

/* -----------------------
   Rendering
------------------------*/
function labelCard(c){
  if(c.r==="Joker") return "Joker";
  return `${c.r}${c.s}`;
}

function cardNode(c, owner, idx, small=false){
  const el = document.createElement("div");
  el.className = "card " + `s-${c.s}` + (small?" small":"");
  el.textContent = labelCard(c);
  el.dataset.owner = owner;
  el.dataset.idx = idx;

  el.classList.add("clickable");

  if(isAce(c)) el.classList.add("A");
  if(isRoyalSpade(c)) el.classList.add("royal");

  el.addEventListener("click", ()=>onCardClick(owner, idx));
  return el;
}

function shipNode(ship, pid, sidx){
  const tpl = $("#shipTpl");
  const el = tpl.content.firstElementChild.cloneNode(true);

  const header = el.querySelector(".shipHeader .name");
  header.textContent = ship.name;

  if(ship.flagship) el.classList.add("flag");

  el.querySelector(".hullVal").textContent = `${Math.max(0,ship.stats.hull)}/${ship.stats.hullMax}`;
  el.querySelector(".engVal").textContent = ship.stats.engine;
  el.querySelector(".shVal").textContent = ship.stats.shield;

  const shState = el.querySelector("#shieldState");
  shState.textContent = ship.shieldActive ? "(active)" :
                        ship.shieldCooldown>0 ? `(cooldown ${ship.shieldCooldown})` : "";

  const wepVal = el.querySelector(".wepVal");
  if(ship.weaponsOffline>0) wepVal.innerHTML = `<span class="down">${ship.stats.weapons}</span>`;
  else wepVal.textContent = ship.stats.weapons || 0;

  const tags = el.querySelector(".tags");
  ship.tags.forEach(t=>{
    const chip = document.createElement("span");
    chip.className="tag";
    chip.textContent=t;
    tags.appendChild(chip);
  });

  // target highlighting
  if(S.ui.highlight.ships.some(h=>h.pid===pid && h.idx===sidx)){
    el.classList.add("highlightTarget");
  }

  // click: choose ship for actions
  el.addEventListener("click", ()=>onShipClick(pid, sidx));

  return el;
}

function render(){
  $("#playerTurn").textContent = S.started ? `${current().name}'s turn` : "Not started";
  $("#phase").textContent = S.started ? `• Phase: ${S.phase}` : "";
  $("#deckCount").textContent = S.started ? `• Deck: ${S.deck.length}` : "";

  // Actions availability (fresh turn)
  const usedAction = $("#btnEnd").disabled===false; // if End is enabled, action already used
  $("#btnBuild").disabled = !S.started || usedAction;
  $("#btnLaunch").disabled = !S.started || usedAction;
  $("#btnAttack").disabled = !S.started || usedAction;
  $("#btnCrown").disabled = !S.started || usedAction;
  $("#btnSpecial").disabled = !S.started || usedAction;
  $("#btnEnd").disabled = !S.started || true; // locked until we actually act

  // AI controls
  $("#aiEnabled").checked = S.players[1].isAI;

  // Hands
  const p0H = $("#p0Hand"); p0H.innerHTML="";
  S.players[0].hand.forEach((c,i)=>p0H.appendChild(cardNode(c,0,i)));
  const p1H = $("#p1Hand"); p1H.innerHTML="";
  // Show P2 hand face-down unless it’s their turn on hotseat; to keep it simple, always face-down
  S.players[1].hand.forEach((c,i)=>{
    const n = cardNode({s:"?",r:"?"},1,i);
    n.textContent = "🂠";
    n.classList.add("dim");
    p1H.appendChild(n);
  });

  // Ships
  const p0S = $("#p0Ships"); p0S.innerHTML="";
  S.players[0].ships.forEach((sh,i)=>p0S.appendChild(shipNode(sh,0,i)));
  const p1S = $("#p1Ships"); p1S.innerHTML="";
  S.players[1].ships.forEach((sh,i)=>p1S.appendChild(shipNode(sh,1,i)));

  // Pending Launch UI
  const pending = S.ui.pendingLaunch;
  if(pending.clubs!=null || pending.hearts!=null){
    $("#pendingLaunch").classList.remove("hidden");
  } else {
    $("#pendingLaunch").classList.add("hidden");
  }
  $("#launchClubs").textContent = pending.clubs==null?"[♣]":labelCard(S.players[S.turn].hand[pending.clubs]||{r:"?"});
  $("#launchHearts").textContent = pending.hearts==null?"[♥]":labelCard(S.players[S.turn].hand[pending.hearts]||{r:"?"});
}

function log(t){
  const row = document.createElement("div");
  row.className="entry";
  row.textContent = t;
  $("#log").appendChild(row);
  $("#log").scrollTop = $("#log").scrollHeight;
}

function hint(t){ $("#hint").textContent = t||""; }

/* -----------------------
   Input Handlers
------------------------*/
function onCardClick(owner, idx){
  if(!S.started) return;
  const me = current();
  if(owner!==S.turn) return;

  const c = me.hand[idx];
  if(!c) return;

  const usedAction = $("#btnEnd").disabled===false;

  // Launch mode expects ♣ + ♥ selection
  if(S.ui.mode==="launch"){
    if(c.s==="♣"){
      S.ui.pendingLaunch.clubs = idx;
    } else if(c.s==="♥"){
      S.ui.pendingLaunch.hearts = idx;
    } else {
      hint("Need a ♣ and a ♥ for launch.");
    }
    render();
    return;
  }

  // If action already used, ignore regular card clicks
  if(usedAction) return;

  S.ui.selectedCard = {owner:owner, idx};
  // Provide contextual help
  if(isAce(c)) hint("Tap a friendly ship to Crown it.");
  else if(isRoyalSpade(c) || isJoker(c)) hint("Tap a valid target ship (or your own for Q♠).");
  else hint("Tap a friendly ship to install this card.");
}

function onShipClick(pid, sidx){
  if(!S.started) return;

  const me = current();
  const myTurn = pid===S.turn;
  const usedAction = $("#btnEnd").disabled===false;

  // If we have a selected card, try to apply it
  const sel = S.ui.selectedCard;
  if(sel && sel.owner===S.turn){
    const c = me.hand[sel.idx];

    if(isAce(c)){
      if(!myTurn){ hint("Crown your own ship."); return; }
      performCrown(sel.idx, sidx);
      return;
    }

    if(isJoker(c)){
      if(myTurn){ hint("Joker targets an enemy ship with weapons."); return; }
      performSpecial(sel.idx, pid, sidx, null);
      return;
    }

    if(isRoyalSpade(c)){
      if(c.r==="Q"){
        if(!myTurn){ hint("Q♠ targets one of your ships."); return; }
        performSpecial(sel.idx, null, null, sidx);
        return;
      }else{
        if(myTurn){ hint("J♠/K♠ target an enemy ship."); return; }
        performSpecial(sel.idx, pid, sidx, null);
        return;
      }
    }

    // Regular build/install
    if(!myTurn){ hint("Install on your own ship."); return; }
    performBuild(sel.idx, sidx);
    return;
  }

  // No card selected → maybe attack selection
  if(!usedAction && myTurn){
    // start attack targeting: select attacker then foe
    if(pid===S.turn){
      // choose attacker first
      S.ui.mode = "attackChooseAttacker";
      S.ui.highlight = {ships:[{pid,idx:sidx}], foeShips: foe().ships.map((_,i)=>({pid:foe().id, idx:i}))};
      hint("Now tap an enemy ship to target.");
    } else {
      // if attacker already chosen, handle
    }
    render();
  } else if(!usedAction && !myTurn && S.ui.mode==="attackChooseAttacker"){
    // defender chosen
    const attackerIdx = S.ui.highlight.ships[0]?.idx ?? 0;
    performAttack(attackerIdx, pid, sidx);
    S.ui.highlight = {ships:[], foeShips:[]};
  }
}

/* -----------------------
   AI (Easy)
------------------------*/
function aiAct(){
  if(!S.started || !current().isAI) return;

  // Simple logic:
  // 1) If can Crown and has Ace, crown biggest hull ship.
  // 2) If can attack, attack lowest-hull enemy with strongest attacker.
  // 3) If can launch and has ♣+♥ and fleet space, launch.
  // 4) Otherwise build highest value onto random own ship.
  const me = current();
  const foeP = (S.turn+1)%2;

  // Crown
  const aIdx = me.hand.findIndex(isAce);
  if(aIdx>-1 && me.ships.length){
    const target = me.ships.map((s,i)=>({i, hv:s.stats.hullMax})).sort((a,b)=>b.hv-a.hv)[0].i;
    performCrown(aIdx, target);
    $("#btnEnd").disabled=false;
    setTimeout(()=>endTurn(), 300);
    return;
  }

  // Attack
  const attackers = me.ships
    .map((s,i)=>({i, wep:s.stats.weapons, off:s.weaponsOffline}))
    .filter(x=>x.wep>0 && x.off===0).sort((a,b)=>b.wep-a.wep);
  const defenders = S.players[foeP].ships
    .map((s,i)=>({i, hp:s.stats.hull + (s.shieldActive? s.stats.shield:0)}))
    .sort((a,b)=>a.hp-b.hp);

  if(attackers.length && defenders.length){
    performAttack(attackers[0].i, foeP, defenders[0].i);
    $("#btnEnd").disabled=false;
    setTimeout(()=>endTurn(), 300);
    return;
  }

  // Launch
  if(me.ships.length < MAX_FLEET){
    const cIdx = me.hand.findIndex(x=>x.s==="♣");
    const hIdx = me.hand.findIndex(x=>x.s==="♥");
    if(cIdx>-1 && hIdx>-1){
      S.ui.pendingLaunch = {clubs:cIdx, hearts:hIdx};
      confirmLaunch();
      $("#btnEnd").disabled=false;
      setTimeout(()=>endTurn(), 300);
      return;
    }
  }

  // Build
  if(me.ships.length){
    const shipIndex = 0;
    // prefer ♦ → ♥ → ♣ → ♠ (weapons that fit)
    let pick = me.hand.findIndex(x=>x.s==="♦");
    if(pick<0) pick = me.hand.findIndex(x=>x.s==="♥");
    if(pick<0) pick = me.hand.findIndex(x=>x.s==="♣");
    if(pick<0){
      pick = me.hand.findIndex(x=>x.s==="♠" && (!isRoyalSpade(x)) && rankValue(x.r)<=stackValue(me.ships[shipIndex].stacks.clubs));
    }
    if(pick>-1){
      performBuild(pick, shipIndex);
      $("#btnEnd").disabled=false;
      setTimeout(()=>endTurn(), 300);
      return;
    }
  }

  // Nothing useful
  $("#btnEnd").disabled=false;
  setTimeout(()=>endTurn(), 300);
}

/* -----------------------
   Wire Up UI Buttons
------------------------*/
function bind(){
  $("#btnNew").addEventListener("click", startGame);
  $("#btnUndo").addEventListener("click", undo);

  $("#btnBuild").addEventListener("click", ()=>{
    S.ui.mode="build"; hint("Select a card, then tap one of your ships to install.");
  });
  $("#btnLaunch").addEventListener("click", beginLaunch);
  $("#btnConfirmLaunch").addEventListener("click", confirmLaunch);
  $("#btnCancelLaunch").addEventListener("click", cancelLaunch);

  $("#btnAttack").addEventListener("click", ()=>{
    S.ui.mode="attack"; hint("Tap your attacker, then tap an enemy target.");
    // highlight both sides for clarity
    S.ui.highlight.foeShips = foe().ships.map((_,i)=>({pid:foe().id, idx:i}));
  });

  $("#btnCrown").addEventListener("click", ()=>{
    S.ui.mode="crown"; hint("Select an Ace, then tap your ship to crown.");
  });

  $("#btnSpecial").addEventListener("click", ()=>{
    S.ui.mode="special"; hint("Select J♠/Q♠/K♠/Joker, then tap a valid target ship.");
  });

  $("#btnEnd").addEventListener("click", endTurn);

  $("#aiEnabled").addEventListener("change", (e)=>{
    S.players[1].isAI = e.target.checked;
  });
}

bind();
render();