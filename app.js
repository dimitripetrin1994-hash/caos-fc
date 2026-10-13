const STORAGE_KEY = "caosfc-v1";

const defaultState = {
  players: [],
  matchCount: 0,
  history: [],
  objectives: [],
  constraints: [],
  lastEventId: null
};

let state = loadState();
let toastTimer = null;
let installPrompt = null;

const events = [
  { id:"nothing", title:"Per una volta, tutto tranquillo", rarity:"Nessun imprevisto", tier:"nessuno", icon:"😌", description:"La settimana è filata liscia. Nessuna emergenza, nessuna telefonata del presidente. Puoi preparare la partita come avevi previsto.", effect:"Nessun vincolo aggiuntivo.", weight:50, apply:() => ({message:"Nessun imprevisto: puoi schierare chi vuoi."}) },
  { id:"cocco", title:"Il cocco del mister", rarity:"Comune", tier:"comune", icon:"💚", description:"Lo staff ha deciso: un giocatore della tua rosa è diventato il preferito assoluto dell'allenatore. Deve partire titolare, anche se non è in forma.", effect:"Il giocatore estratto deve essere titolare in questa partita.", weight:10, apply:() => {
    const p = randomPlayer();
    if (!p) return noPlayerFallback();
    addConstraint("Cocco del mister", `${p.name} (${p.role}) deve essere titolare nella prossima partita.`, 1);
    return {message:`${p.name} deve essere titolare nella prossima partita.`};
  }},
  { id:"notte-brava", title:"Notte brava", rarity:"Comune", tier:"comune", icon:"🥴", description:"Un titolare si è presentato all'allenamento con le occhiaie fino alle ginocchia. Lo staff medico non vuole rischiare.", effect:"Un giocatore casuale non può essere schierato nella prossima partita.", weight:7, apply:() => {
    const p = randomPlayer();
    if (!p) return noPlayerFallback();
    addConstraint("Notte brava", `${p.name} non può essere schierato nella prossima partita.`, 1);
    return {message:`${p.name} è indisponibile per la prossima partita.`};
  }},
  { id:"mamma", title:"Problemi in famiglia", rarity:"Comune", tier:"comune", icon:"📞", description:"Un giocatore riceve una brutta notizia da casa e non riesce a concentrarsi. Ha bisogno di stare vicino alla famiglia.", effect:"Scegli tu: panchina per una partita oppure assenza agli allenamenti.", weight:4, apply:() => {
    const p = randomPlayer();
    if (!p) return noPlayerFallback();
    addConstraint("Problemi in famiglia", `${p.name}: decidi tu se lasciarlo in panchina per una partita o segnare un allenamento saltato.`, 1);
    return {message:`Devi decidere come gestire ${p.name}: panchina o allenamento saltato.`};
  }},
  { id:"litigio", title:"Spogliatoio spaccato", rarity:"Insolito", tier:"insolito", icon:"💥", description:"Due compagni hanno litigato pesantemente. Non vogliono passarsi la palla e lo spogliatoio è una polveriera.", effect:"Due giocatori estratti non possono giocare insieme nella prossima partita.", weight:4, apply:() => {
    const pair = randomPlayers(2);
    if (pair.length < 2) return noPlayerFallback();
    addConstraint("Spogliatoio spaccato", `${pair[0].name} e ${pair[1].name} non possono essere schierati insieme nella prossima partita.`, 1);
    return {message:`${pair[0].name} e ${pair[1].name} non possono giocare insieme.`};
  }},
  { id:"infortunio", title:"Stop muscolare", rarity:"Insolito", tier:"insolito", icon:"🩹", description:"Una fitta durante il riscaldamento. Non è gravissimo, ma il preparatore impone prudenza.", effect:"Un giocatore salta le prossime 2 partite.", weight:3, apply:() => {
    const p = randomPlayer();
    if (!p) return noPlayerFallback();
    addConstraint("Stop muscolare", `${p.name} è indisponibile per le prossime 2 partite.`, 2);
    return {message:`${p.name} salta le prossime 2 partite.`};
  }},
  { id:"portiere", title:"Il portiere ha perso fiducia", rarity:"Insolito", tier:"insolito", icon:"🧤", description:"Il tuo portiere titolare ha commesso un errore clamoroso in allenamento e chiede di fermarsi un turno.", effect:"Se hai un altro portiere, devi schierarlo titolare.", weight:2, apply:() => {
    const keepers = state.players.filter(p => p.role === "POR");
    if (keepers.length < 2) {
      addConstraint("Portiere sotto pressione", "Il tuo portiere titolare non può essere capitano nella prossima partita.", 1);
      return {message:"Hai meno di due portieri: il tuo portiere non può essere capitano per una partita."};
    }
    const p = keepers[Math.floor(Math.random() * keepers.length)];
    addConstraint("Cambio in porta", `${p.name} deve essere il portiere titolare nella prossima partita.`, 1);
    return {message:`${p.name} deve essere il portiere titolare.`};
  }},
  { id:"giovane", title:"Il ragazzino fenomeno", rarity:"Insolito", tier:"insolito", icon:"🌟", description:"Un giovane della rosa ha impressionato tutti in allenamento. I tifosi vogliono vederlo in campo.", effect:"Il giocatore con valutazione più bassa deve partire titolare.", weight:2, apply:() => {
    if (!state.players.length) return noPlayerFallback();
    const p = [...state.players].sort((a,b) => a.rating - b.rating)[0];
    addConstraint("Fiducia ai giovani", `${p.name} deve essere titolare nella prossima partita.`, 1);
    return {message:`${p.name} deve partire titolare: il mister ha deciso.`};
  }},
  { id:"presidente", title:"Il presidente pretende 10 gol", rarity:"Raro", tier:"raro", icon:"📈", description:"Il presidente ha fissato un obiettivo pubblico: il tuo attaccante più forte deve segnare 10 gol entro la fine delle prossime 5 partite.", effect:"Segna manualmente i gol. Se non raggiunge l'obiettivo, devi vendere metà rosa.", weight:1.5, apply:() => {
    const attackers = state.players.filter(p => ["ATT","AS","AD"].includes(p.role)).sort((a,b) => b.rating-a.rating);
    const p = attackers[0] || [...state.players].sort((a,b) => b.rating-a.rating)[0];
    if (!p) return noPlayerFallback();
    const obj = {id:makeId(), title:"Il presidente pretende 10 gol", detail:`${p.name} deve segnare 10 gol entro 5 partite. Se fallisce, devi vendere metà della rosa.`, playerId:p.id, target:10, current:0, matchesLeft:5, penalty:"Vendi metà della rosa", done:false};
    state.objectives.unshift(obj);
    return {message:`Obiettivo attivo: ${p.name} deve segnare 10 gol entro 5 partite.`};
  }},
  { id:"squalifica", title:"Squalifica a sorpresa", rarity:"Raro", tier:"raro", icon:"🟥", description:"Il giudice sportivo ha deciso di usare il pugno duro. Un giocatore salta la prossima partita.", effect:"Il giocatore estratto è indisponibile per una partita.", weight:1, apply:() => {
    const p = randomPlayer();
    if (!p) return noPlayerFallback();
    addConstraint("Squalifica", `${p.name} è squalificato per la prossima partita.`, 1);
    return {message:`${p.name} è squalificato per la prossima partita.`};
  }},
  { id:"trattativa", title:"Offerta irrinunciabile", rarity:"Raro", tier:"raro", icon:"💸", description:"Un altro club ha fatto un'offerta enorme per un tuo titolare. La società vuole dimostrare che nessuno è intoccabile.", effect:"Devi scegliere un titolare e lasciarlo in panchina nella prossima partita.", weight:0.8, apply:() => {
    addConstraint("Offerta irrinunciabile", "Scegli uno dei tuoi titolari abituali e lascialo in panchina nella prossima partita.", 1);
    return {message:"Devi lasciare in panchina un titolare abituale a tua scelta."};
  }},
  { id:"tifosi", title:"Rivolta dei tifosi", rarity:"Molto raro", tier:"raro", icon:"📣", description:"La curva è furiosa per lo scarso spazio concesso ai giovani. La società vuole una risposta immediata.", effect:"Almeno 2 giocatori con valutazione 65 o inferiore devono partire titolari, se disponibili.", weight:0.4, apply:() => {
    addConstraint("Rivolta dei tifosi", "Schiera titolari almeno 2 giocatori con valutazione 65 o inferiore, se ne hai disponibili.", 1);
    return {message:"Devi dare spazio ai giocatori meno valutati."};
  }},
  { id:"acquisizione", title:"Il nuovo proprietario", rarity:"Assurdo", tier:"assurdo", icon:"🤑", description:"Un miliardario acquista il club e annuncia la sua prima regola: basta veterani. La rivoluzione parte subito.", effect:"Per le prossime 3 partite puoi schierare soltanto giocatori sotto i 23 anni: segna manualmente l'età nei nomi o usa questo vincolo come regola.", weight:0.1, apply:() => {
    addConstraint("Il nuovo proprietario", "Per le prossime 3 partite puoi schierare soltanto giocatori sotto i 23 anni. Tieni traccia dell'età nella rosa.", 3);
    return {message:"Regola speciale attiva per 3 partite: soltanto Under 23."};
  }},
  { id:"trump", title:"Breaking news: il club è stato comprato", rarity:"Assurdo", tier:"assurdo", icon:"🌎", description:"Un annuncio completamente folle scuote il mondo del calcio: un personaggio politico famosissimo compra il club e vuole dettare le regole della formazione.", effect:"Per le prossime 2 partite devi cambiare almeno 5 titolari rispetto alla partita precedente.", weight:0.1, apply:() => {
    addConstraint("Rivoluzione societaria", "Per le prossime 2 partite devi cambiare almeno 5 titolari rispetto alla partita precedente.", 2);
    return {message:"Il caos societario impone almeno 5 cambi di formazione per 2 partite."};
  }}
];

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.players)) return {...defaultState, ...saved};
  } catch (_) {}
  return structuredClone(defaultState);
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function makeId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function randomPlayer() { return state.players.length ? state.players[Math.floor(Math.random() * state.players.length)] : null; }
function randomPlayers(count) {
  const copy = [...state.players];
  const chosen = [];
  while (copy.length && chosen.length < count) chosen.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  return chosen;
}
function noPlayerFallback() {
  addConstraint("Rosa incompleta", "Aggiungi giocatori alla rosa prima della prossima estrazione.", 1);
  return {message:"Non hai ancora inserito giocatori: ho registrato un promemoria. Aggiungi la rosa per gli eventi personalizzati."};
}
function addConstraint(title, detail, matchesLeft) {
  state.constraints.unshift({id:makeId(), title, detail, matchesLeft});
}
function weightedPick() {
  // Probabilità esatte a livello di categoria: 50% nessun evento, 50% un imprevisto.
  if (Math.random() < 0.5) return events.find(event => event.id === "nothing");
  const possible = events.filter(event => event.id !== "nothing");
  const total = possible.reduce((sum, event) => sum + event.weight, 0);
  let value = Math.random() * total;
  for (const event of possible) {
    value -= event.weight;
    if (value < 0) return event;
  }
  return possible[0];
}
function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}
function renderStats() {
  document.getElementById("playerCount").textContent = state.players.length;
  document.getElementById("matchCount").textContent = state.matchCount;
  document.getElementById("objectiveCount").textContent = state.objectives.filter(o => !o.done).length;
  document.getElementById("rosterTotal").textContent = `${state.players.length} GIOCATORI`;
}
function renderRoster() {
  const container = document.getElementById("rosterList");
  if (!state.players.length) {
    container.innerHTML = '<div class="empty-state">La rosa è ancora vuota.<br>Aggiungi i tuoi giocatori qui sopra oppure carica la rosa demo.</div>';
    return;
  }
  container.innerHTML = state.players.map(p => `
    <div class="list-item">
      <div class="player-avatar">${escapeHTML(p.role)}</div>
      <div class="item-main"><div class="item-title">${escapeHTML(p.name)}</div><div class="item-subtitle">In rosa · ID ${escapeHTML(p.id.slice(-4))}</div></div>
      <span class="rating">${p.rating}</span>
      <button class="small-action danger" data-remove-player="${p.id}" aria-label="Rimuovi ${escapeHTML(p.name)}">✕</button>
    </div>`).join("");
}
function renderConstraints() {
  const container = document.getElementById("activeConstraints");
  if (!state.constraints.length) {
    container.innerHTML = '<div class="empty-state">Nessun vincolo attivo. Per ora l’allenatore può dormire tranquillo.</div>';
    return;
  }
  container.innerHTML = state.constraints.map(c => `
    <div class="list-item">
      <div class="player-avatar">!</div>
      <div class="item-main"><div class="item-title">${escapeHTML(c.title)}</div><div class="item-subtitle">${escapeHTML(c.detail)} · Partite rimanenti: ${c.matchesLeft}</div></div>
      <button class="small-action" data-resolve="${c.id}">Risolto</button>
    </div>`).join("");
}
function renderObjectives() {
  const container = document.getElementById("objectivesList");
  const list = state.objectives;
  if (!list.length) {
    container.innerHTML = '<div class="empty-state">Nessun obiettivo in corso. Per ora il presidente non ti sta col fiato sul collo.</div>';
    return;
  }
  container.innerHTML = list.map(o => `
    <div class="list-item">
      <div class="player-avatar">${o.done ? "✓" : "🎯"}</div>
      <div class="item-main"><div class="item-title">${escapeHTML(o.title)}</div><div class="item-subtitle">${escapeHTML(o.detail)}<br>Progresso: ${o.current || 0}/${o.target || "—"} · Partite rimaste: ${o.matchesLeft ?? "—"}${o.failed ? " · FALLITO" : ""}</div></div>
      ${!o.done && !o.failed ? `<button class="small-action" data-goal="${o.id}">+1 gol</button>` : ""}
    </div>`).join("");
}
function renderHistory() {
  const container = document.getElementById("historyList");
  if (!state.history.length) {
    container.innerHTML = '<div class="empty-state">Lo storico è vuoto. La prossima estrazione farà storia.</div>';
    return;
  }
  container.innerHTML = state.history.slice(0, 20).map(h => `
    <div class="list-item">
      <div class="player-avatar">${escapeHTML(h.icon)}</div>
      <div class="item-main"><div class="item-title">${escapeHTML(h.title)}</div><div class="item-subtitle">Partita ${h.match} · ${escapeHTML(h.message)}<br>${escapeHTML(h.date)}</div></div>
    </div>`).join("");
}
function renderEventCard(event, message) {
  const stage = document.getElementById("cardStage");
  stage.innerHTML = `
    <article class="event-card rarity-${event.tier}">
      <div class="card-top"><span class="rarity-label">${escapeHTML(event.rarity)}</span><span class="pill">PARTITA ${state.matchCount}</span></div>
      <div class="card-icon">${event.icon}</div>
      <h3>${escapeHTML(event.title)}</h3>
      <p class="event-description">${escapeHTML(event.description)}</p>
      <div class="card-effect">⚠ ${escapeHTML(event.effect)}</div>
      <p class="event-description" style="margin-top:12px;color:#b6f36b"><strong>Conseguenza:</strong> ${escapeHTML(message)}</p>
    </article>`;
}
function render() {
  renderStats(); renderRoster(); renderConstraints(); renderObjectives(); renderHistory();
  saveState();
}
function drawEvent() {
  const event = weightedPick();
  const result = event.apply();
  state.matchCount += 1;
  // Decrementa i vincoli già presenti a inizio partita, non quelli appena estratti.
  state.constraints.forEach(c => { if (c.matchesLeft > 0 && !c.justAdded) c.matchesLeft -= 1; });
  state.constraints = state.constraints.filter(c => c.matchesLeft > 0);
  state.constraints.forEach(c => delete c.justAdded);
  // Il vincolo appena creato deve partire dal numero completo di partite.
  // L'app usa il testo come promemoria; il giocatore conferma manualmente quando risolto.
  const entry = {id:makeId(), title:event.title, icon:event.icon, message:result.message, match:state.matchCount, date:new Date().toLocaleString("it-IT")};
  state.history.unshift(entry);
  state.lastEventId = event.id;
  renderEventCard(event, result.message);
  document.getElementById("drawBtn").textContent = "⚡ Estrai per la prossima partita";
  document.getElementById("drawBtn").disabled = false;
  render();
  showToast(event.id === "nothing" ? "Nessun imprevisto questa volta." : "Carta estratta: applica la conseguenza!");
}
function addPlayer(name, role, rating) {
  state.players.push({id:makeId(), name:name.trim(), role, rating:Number(rating)});
  render();
}
function switchTab(tabName) {
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tabName));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("hidden", p.id !== `tab-${tabName}`));
}

document.querySelectorAll(".tab").forEach(button => button.addEventListener("click", () => switchTab(button.dataset.tab)));
document.getElementById("drawBtn").addEventListener("click", drawEvent);
document.getElementById("playerForm").addEventListener("submit", event => {
  event.preventDefault();
  const name = document.getElementById("playerName").value.trim();
  const role = document.getElementById("playerRole").value;
  const rating = Number(document.getElementById("playerRating").value);
  if (!name || rating < 1 || rating > 99) { showToast("Controlla nome e valutazione."); return; }
  addPlayer(name, role, rating);
  event.target.reset();
  document.getElementById("playerRating").value = 70;
  showToast(`${name} aggiunto alla rosa.`);
});
document.getElementById("rosterList").addEventListener("click", event => {
  const button = event.target.closest("[data-remove-player]");
  if (!button) return;
  const player = state.players.find(p => p.id === button.dataset.removePlayer);
  if (player && confirm(`Vuoi rimuovere ${player.name} dalla rosa?`)) {
    state.players = state.players.filter(p => p.id !== player.id);
    render(); showToast("Giocatore rimosso.");
  }
});
document.getElementById("activeConstraints").addEventListener("click", event => {
  const button = event.target.closest("[data-resolve]");
  if (!button) return;
  state.constraints = state.constraints.filter(c => c.id !== button.dataset.resolve);
  render(); showToast("Vincolo rimosso.");
});
document.getElementById("objectivesList").addEventListener("click", event => {
  const button = event.target.closest("[data-goal]");
  if (!button) return;
  const goal = state.objectives.find(o => o.id === button.dataset.goal);
  if (!goal) return;
  goal.current = (goal.current || 0) + 1;
  if (goal.current >= goal.target) { goal.done = true; showToast("Obiettivo completato!"); }
  else showToast("Gol registrato. Ricordati di aggiornare il progresso dopo le partite.");
  render();
});
document.getElementById("demoBtn").addEventListener("click", () => {
  if (state.players.length && !confirm("Aggiungere la rosa demo a quella esistente?")) return;
  const demo = [
    ["Luca Bianchi","POR",75],["Matteo Conti","DC",72],["Andrea Moretti","DC",74],
    ["Simone Galli","TS",69],["Federico Ricci","TD",70],["Tommaso Riva","CDC",76],
    ["Davide Costa","CC",78],["Nicolò Greco","COC",80],["Alessio Romano","AS",77],
    ["Gabriele Martini","AD",73],["Edoardo Ferri","ATT",82],["Pietro Neri","POR",65],
    ["Michele Sala","CC",64],["Samuele Villa","ATT",68],["Filippo Serra","DC",66]
  ];
  demo.forEach(([name,role,rating]) => state.players.push({id:makeId(),name,role,rating}));
  render(); showToast("Rosa demo aggiunta. Puoi modificarla liberamente.");
});
document.getElementById("clearHistoryBtn").addEventListener("click", () => {
  if (confirm("Vuoi cancellare lo storico degli imprevisti?")) { state.history = []; render(); showToast("Storico cancellato."); }
});
document.getElementById("resetBtn").addEventListener("click", () => {
  if (confirm("Attenzione: vuoi davvero cancellare rosa, obiettivi, vincoli e storico?")) {
    state = structuredClone(defaultState);
    state.lastEventId = null;
    document.getElementById("cardStage").innerHTML = '<div class="card-placeholder"><div class="question-mark">?</div><h3>Che cosa può andare storto?</h3><p>Prepara la rosa e scopri il prossimo imprevisto.</p></div>';
    document.getElementById("drawBtn").disabled = false;
    document.getElementById("drawBtn").textContent = "⚡ Estrai imprevisto";
    render(); showToast("Dati azzerati.");
  }
});
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault(); installPrompt = event;
  document.getElementById("installBtn").classList.remove("hidden");
});
document.getElementById("installBtn").addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  document.getElementById("installBtn").classList.add("hidden");
});

// Ripristina la carta dell'ultima estrazione quando si riapre la pagina.
render();
if (state.history.length && state.history[0].match === state.matchCount) {
  const last = state.history[0];
  const ev = events.find(e => e.title === last.title);
  if (ev) {
    renderEventCard(ev, last.message);
    document.getElementById("drawBtn").textContent = "⚡ Estrai per la prossima partita";
    document.getElementById("drawBtn").disabled = false;
  }
}
