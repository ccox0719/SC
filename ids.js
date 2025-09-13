/* FILE_ID: SFB/ids v1.0.0
   Purpose: single source for DOM IDs, classes, and filenames. */

export const FILES = Object.freeze({
  html: "index.html",
  css: "style.css",
  app: "app.js",
  ids: "ids.js",
  domcheck: "dom-check.js",
  manifest: "update.json",
  instructions: "instructions.md"
});

export const ID = Object.freeze({
  turnBanner: "turnBanner",
  playerTurn: "playerTurn",
  phase: "phase",
  deckCount: "deckCount",

  btnNew: "btnNew",
  btnUndo: "btnUndo",
  aiEnabled: "aiEnabled",
  aiLevel: "aiLevel",

  p0Zone: "p0Zone",
  p0Ships: "p0Ships",
  p0Hand: "p0Hand",

  p1Zone: "p1Zone",
  p1Ships: "p1Ships",
  p1Hand: "p1Hand",

  actions: "actions",
  btnBuild: "btnBuild",
  btnLaunch: "btnLaunch",
  btnAttack: "btnAttack",
  btnCrown: "btnCrown",
  btnSpecial: "btnSpecial",
  btnEnd: "btnEnd",

  context: "context",
  hint: "hint",
  pendingLaunch: "pendingLaunch",
  launchClubs: "launchClubs",
  launchHearts: "launchHearts",
  btnConfirmLaunch: "btnConfirmLaunch",
  btnCancelLaunch: "btnCancelLaunch",

  log: "log",

  shipTpl: "shipTpl"
});

export const CLASSN = Object.freeze({
  hidden: "hidden",
  highlightTarget: "highlightTarget",
  dim: "dim",
  card: "card",
  small: "small",
});

export const REQUIRED_IDS = Object.freeze([
  // header / banner
  ID.turnBanner, ID.playerTurn, ID.phase, ID.deckCount,
  ID.btnNew, ID.btnUndo, ID.aiEnabled, ID.aiLevel,

  // players
  ID.p0Zone, ID.p0Ships, ID.p0Hand,
  ID.p1Zone, ID.p1Ships, ID.p1Hand,

  // actions & context
  ID.actions, ID.btnBuild, ID.btnLaunch, ID.btnAttack, ID.btnCrown, ID.btnSpecial, ID.btnEnd,
  ID.context, ID.hint, ID.pendingLaunch, ID.launchClubs, ID.launchHearts, ID.btnConfirmLaunch, ID.btnCancelLaunch,

  // log
  ID.log,

  // templates
  ID.shipTpl
]);

/** DOM helpers that assert IDs exist */
export const QS = {
  get(id){ const el = document.getElementById(id); if(!el) throw new Error(`[ids] Missing #${id}`); return el; },
  $: (sel)=>document.querySelector(sel),
  $$: (sel)=>Array.from(document.querySelectorAll(sel))
};
