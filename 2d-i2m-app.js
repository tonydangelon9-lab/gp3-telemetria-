'use strict';
/* AD11 Racing · Telemetría 2D e I2M · lógica de la página (el cálculo está en 2d-i2m-core.js) */
const C = window.TeleCore;
const CFG = { gasURL: 'https://script.google.com/macros/s/AKfycbypkBR15N5V8stvuHYg40XrGZHyQSf-sW0ZN64pQw460TGO4p4lgR-EuTWbyw0cT9-M/exec', timeoutMs: 45000 };
const TOKEN_KEY = 'ad11_2d_token', USER_KEY = 'ad11_2d_user'; /* propios de esta página: salir aquí no cierra la sesión de las páginas antiguas */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isN = v => typeof v === 'number' && isFinite(v);
const fmtN = (v, d) => isN(v) ? v.toLocaleString('es-ES', { minimumFractionDigits: d == null ? 0 : d, maximumFractionDigits: d == null ? 2 : d }) : '—';
const fmtLap = s => { if (!isN(s)) return '—'; const ms = Math.round(s * 1000), m = Math.floor(ms / 60000); return m + ':' + ((ms - m * 60000) / 1000).toFixed(3).padStart(6, '0'); };
const num = v => { if (v == null) return null; const n = parseFloat(String(v).trim().replace(',', '.')); return isNaN(n) ? null : n; };
const numRpm = v => { const t = String(v == null ? '' : v).trim(); return /^[1-9]\d{0,2}([., ]\d{3})+$/.test(t) ? +t.replace(/[., ]/g, '') : num(t); };
const tocar = (P, k) => { if (SES_KEYS.indexOf(k) >= 0) (P.tocados || (P.tocados = new Set())).add(k); };
const SES_KEYS = ['condicion', 'sesion', 'temp_aire', 'temp_pista', 'neum_vueltas', 'notas'], SES_NOM = { condicion: 'pista', sesion: 'tipo de sesión', temp_aire: 'temperatura del aire', temp_pista: 'temperatura de pista', neum_vueltas: 'vueltas del neumático', notas: 'notas' }; /* «13.500» = 13 500 rpm, no 13,5 */
const nextFrame = () => new Promise(r => setTimeout(r, 30));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const localDate = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const safeConf = c => (c === 'alta' || c === 'media' || c === 'baja') ? c : 'baja';
const okCat = c => C.CATS.indexOf(c) >= 0 ? c : 'datos';
const lbl = k => C.CANALES[k] ? C.CANALES[k].label : k;
const KITLBL = { incluido: 'En el kit', opcional: 'Opcional', fuera: 'No viene en el kit', can: 'Por CAN (por confirmar con I2M)', analogico: 'Sensor externo' };
const STORE = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }, del(k) { try { localStorage.removeItem(k); } catch (e) { } } };

/* ===================== estado ===================== */
function newProf() { return { fileName: '', fileSize: 0, text: null, hash: '', table: null, parse: { delimiter: '', decimal: '' }, mapping: {}, mapMsg: '', meta: { fecha: localDate() }, setup: {}, override: {}, A: null, reglas: [], ai: null, runId: 0, dirty: false, snap: null, base: null, sens: 10, hz: '', saved: null, recId: null, saveOrig: false, lastCambioSaved: '', chartCh: 'gps_speed', chartLaps: [] }; }
const ST = { perfil: '2d-moto4', tab: 'cargar', demo: false, user: null, bp: {}, hist: {}, histLoaded: {}, histBad: {}, vault: { key: null, meta: null, state: 'desconocido', entries: [], avisos: [], err: '', listaError: '' }, nb: null, saving: false };
Object.keys(C.PERFILES).forEach(p => { ST.bp[p] = newProf(); });
const PS = () => ST.bp[ST.perfil];
const PF = () => C.PERFILES[ST.perfil];
let TOKEN = STORE.get(TOKEN_KEY); const USER0 = STORE.get(USER_KEY); if (TOKEN && !USER0) TOKEN = null; else ST.user = USER0;

/* ===================== servidor ===================== */
const MEM = {};
function demoGas(action, p) {
  return new Promise(res => setTimeout(() => {
    if (action === 'kv_get') return res({ value: MEM[p.key] != null ? MEM[p.key] : null });
    if (action === 'kv_set') { MEM[p.key] = p.value; return res({ ok: true }); }
    if (action === 'kv_list') return res({ keys: Object.keys(MEM).filter(k => k.indexOf(p.prefix) === 0) });
    if (action === 'kv_dump') return res({ items: Object.keys(MEM).filter(k => k.indexOf(p.prefix) === 0).map(k => [k, MEM[k]]) });
    if (action === 'csv_save') return res({ fileId: 'demo', url: '', bytes: (p.content || '').length });
    if (action === 'ai') return res({ content: [{ text: demoAI(p) }] });
    res({ error: 'acción desconocida en demostración' });
  }, 60));
}
function demoAI(p) {
  const txt = (p.messages && p.messages[0] && p.messages[0].content) || '';
  if (/FRASES DEL PILOTO/.test(txt)) {
    const fr = (txt.split('FRASES DEL PILOTO')[1] || '').split('\n').map(l => l.split(':')[0].trim()).filter(x => /^f\d+$/.test(x));
    return JSON.stringify({ items: fr.map((id, i) => ({ id: id, es: '(traducción de ejemplo)', vocab: '', estado: i % 2 ? 'datos_insuficientes' : 'corroborada', evidencia: i % 2 ? [] : [{ id: 'S.vmax', valor: 0 }], comentario: 'RESPUESTA DE EJEMPLO del modo demostración: no es una lectura real.' })), sin_mencionar: [] });
  }
  return JSON.stringify({ resumen: 'RESPUESTA DE EJEMPLO (modo demostración): no es una lectura real de la IA.', prioridad: { accion: 'Ejemplo: repetir la sesión con un solo cambio', por_que: 'Es el modo demostración.', evidencia: [{ id: 'S.vmax', valor: 0 }] }, hallazgos: [{ titulo: 'Ejemplo de hallazgo', categoria: 'datos', evidencia: [{ id: 'S.vmax', valor: 0 }], interpretacion: 'Aquí aparecería la interpretación con cifras reales.', accion: '', confianza: 'baja' }], no_verificable: ['Todo lo que no tenga canal'], preguntas_al_piloto: ['¿En qué curva lo notaste?'] });
}
const RE_AUTH = /(token|sesi[oó]n).{0,25}(expir|caduc|inv[aá]lid|venci|no v[aá]lid)|(expir|caduc|inv[aá]lid|venci).{0,25}(token|sesi[oó]n)|no autenticad|unauthor|no autorizad|se requiere identificarse|(iniciar|inicia) sesi[oó]n|login required/i; /* solo frases de caducidad; lo demás (permisos de Drive, claves de la IA, «tokens») no abre el login. El servidor puede mandar code:"AUTH" */
let CTRL = null;
async function gas(action, payload) {
  if (ST.demo) return demoGas(action, payload || {});
  if (!TOKEN && action !== 'login') { needLogin(); const e = new Error('Inicia sesión para continuar.'); e.code = 'AUTH'; throw e; }
  const body = JSON.stringify(Object.assign({ action: action, token: TOKEN }, payload || {}));
  const ctrl = new AbortController(); CTRL = ctrl; const to = setTimeout(() => { ctrl.timedOut = true; ctrl.abort(); }, CFG.timeoutMs);
  try {
    let r, j;
    try { r = await fetch(CFG.gasURL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body, signal: ctrl.signal }); if (!r.ok) { const e = new Error('El servidor respondió HTTP ' + r.status + '.'); e.code = 'HTTP'; throw e; } j = await r.json(); }
    catch (e) {
      if (typeof e.code === 'string') throw e; /* los errores propios llevan código de texto; el AbortError del navegador lleva un número */
      if (ctrl.cancelado) { const er = new Error('Cancelado.'); er.code = 'CANCEL'; throw er; }
      if (ctrl.timedOut) { const er = new Error('El servidor no respondió en ' + Math.round(CFG.timeoutMs / 1000) + ' s. Puede que la operación SÍ se haya hecho: compruébalo antes de repetirla.'); er.code = 'TIMEOUT'; throw er; }
      if (e instanceof SyntaxError || (e && e.name === 'SyntaxError')) { const er = new Error('Respuesta ilegible del servidor.'); er.code = 'HTTP'; throw er; }
      const er = new Error('Sin conexión con el servidor.'); er.code = 'NET'; throw er;
    }
    if (j && j.error) {
      const er = new Error(String(j.error));
      if (action !== 'login' && (j.code === 'AUTH' || RE_AUTH.test(er.message))) { er.code = 'AUTH'; er.message += ' (si se repite, sal y vuelve a entrar)'; needLogin(); }
      throw er;
    }
    return j;
  } finally { clearTimeout(to); if (CTRL === ctrl) CTRL = null; }
}
const kvGet = async k => { const j = await gas('kv_get', { key: k }); return (j && j.value != null) ? j.value : null; };
const kvSet = (k, v) => gas('kv_set', { key: k, value: v });
const kvList = async p => { const j = await gas('kv_list', { prefix: p }); return (j && Array.isArray(j.keys)) ? j.keys : []; };
async function kvDump(p) {
  try { const j = await gas('kv_dump', { prefix: p }); if (j && Array.isArray(j.items)) return j.items; }
  catch (e) { if (e.code === 'AUTH' || e.code === 'NET' || e.code === 'TIMEOUT' || e.code === 'CANCEL') throw e; }
  const ks = await kvList(p), out = []; for (const k of ks) { const v = await kvGet(k); if (v != null) out.push([k, v]); } return out;
}
async function kvSetVerified(k, str) {
  await kvSet(k, str);
  const back = await kvGet(k);
  const bs = back == null ? null : (typeof back === 'string' ? back : JSON.stringify(back));
  if (bs !== str) throw new Error('El servidor no devolvió lo mismo que se guardó: NO se considera guardado.');
}
const parseVal = v => { if (v == null) return null; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch (e) { return null; } };

/* ===================== utilidades de pantalla ===================== */
let toastT = null;
function toast(msg, kind) { const t = $('toast'); t.textContent = msg; t.className = kind || ''; t.setAttribute('role', kind === 'err' ? 'alert' : 'status'); t.style.display = 'block'; clearTimeout(toastT); toastT = setTimeout(() => { t.style.display = 'none'; }, kind === 'err' ? 9000 : 3500); }
let busyPrev = null, busySel = '', busyT = null, busyT0 = 0;
function busy(msg, cancelable) { if (msg && $('busy').style.display !== 'flex') { const pa = document.activeElement; busyPrev = pa && pa !== document.body ? pa : null; busySel = busyPrev ? (busyPrev.dataset && busyPrev.dataset.act ? '[data-act="' + busyPrev.dataset.act + '"]' : busyPrev.id ? '#' + busyPrev.id : '') : ''; }
  clearInterval(busyT); const bw = $('busyWait'); if (bw) bw.textContent = ''; if (msg) { busyT0 = Date.now(); busyT = setInterval(() => { const sg = Math.round((Date.now() - busyT0) / 1000); if (bw && sg >= 6) bw.textContent = 'Llevas ' + sg + ' s. Si el servidor no responde, la app se rinde a los ' + Math.round(CFG.timeoutMs / 1000) + ' s y te lo dice.'; }, 1000); } const bc = $('busyCancel'); if (bc) bc.style.display = (msg && cancelable) ? '' : 'none'; /* «Cancelar» solo donde cancelar es seguro: la IA y la subida del original */ $('busyMsg').textContent = msg || ''; $('busy').style.display = msg ? 'flex' : 'none'; ['hdr', 'tabs', 'main'].forEach(k => { const el = k === 'main' ? document.querySelector('main') : k === 'hdr' ? document.querySelector('header') : $('tabs'); if (el) el.inert = !!msg; }); if (msg) { const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); $('busy').focus(); }  if (!msg && (busyPrev || busySel)) { let b = busyPrev; busyPrev = null; const sel = busySel; busySel = ''; setTimeout(() => { let bb = b && document.contains(b) ? b : (sel ? document.querySelector(sel) : null); const a = document.activeElement; if (bb && (!a || a === document.body || a.id === 'busy') && !bb.disabled && bb.focus && bb.offsetParent !== null) { try { bb.focus({ preventScroll: true }); } catch (e) { } } }, 0); } }
function needLogin() { $('loginOverlay').style.display = 'flex'; setTimeout(() => { const u = $('loginUser'); if (u) u.focus(); }, 30); }
const TABS = [['cargar', '1 · Cargar'], ['analisis', '2 · Análisis'], ['historial', '3 · Historial y cambios'], ['cuaderno', '4 · Cuaderno privado']];
function setTab(t) {
  ST.tab = t; TABS.forEach(x => $('tab-' + x[0]).classList.toggle('hidden', x[0] !== t));
  renderTabs(); if (t === 'analisis') renderAnalysis(); else destroyCharts(); if (t === 'historial') renderHistory(); if (t === 'cuaderno') renderNotebook();
  window.scrollTo(0, 0);
}
function renderTabs() {
  $('tabs').innerHTML = TABS.map(t => '<button role="tab" aria-selected="' + (ST.tab === t[0]) + '" class="' + (ST.tab === t[0] ? 'on' : '') + '" data-act="tab" data-v="' + t[0] + '">' + t[1] + '</button>').join('');
}
function renderProfSeg() {
  $('profSeg').innerHTML = Object.keys(C.PERFILES).map(p => '<button aria-pressed="' + (ST.perfil === p) + '" class="' + (ST.perfil === p ? 'on' : '') + '" data-act="prof" data-v="' + p + '">' + esc(C.PERFILES[p].etiqueta) + '</button>').join('');
}
function setPerfil(p) {
  if (!C.PERFILES[p] || p === ST.perfil) return;
  if (nbDirty() && !confirm('Tienes una entrada del cuaderno sin guardar. Si cambias de sistema se descarta. ¿Cambiar de todos modos?')) return;
  ST.nb = null; ST.perfil = p; renderProfSeg(); renderCargar(); if (ST.tab === 'analisis') renderAnalysis(); if (ST.tab === 'historial') renderHistory(); if (ST.tab === 'cuaderno') renderNotebook();
}

/* ===================== pestaña CARGAR ===================== */
const OPT_SESION = ['', 'Libres', 'Test', 'Clasificación', 'Carrera', 'Warm-up'], OPT_PISTA = ['', 'Seca', 'Mojada', 'Mixta'];
function fichaGroups() {
  const dos = PF().id === '2d-moto4';
  const sesion = [['fecha', 'Fecha', 'date'], ['circuito', 'Circuito', 'text', 'Ej.: Jerez'], ['evento', 'Evento', 'text', 'Ej.: FIM MotoJunior R3 / test privado'],
    dos ? ['unidad', 'Moto n.º (1–16)', ['', ...Array.from({ length: 16 }, (_, i) => String(i + 1))]] : ['moto', 'Moto', [['', ''], ...PF().motos.map(m => [m.id, m.nombre])]]];
  if (dos) sesion.push(['logger', 'Logger (versión / serie)', 'text']);
  sesion.push(['sesion', 'Sesión', OPT_SESION], ['piloto', 'Piloto (apodo o código)', 'text', 'Ej.: Piloto A', 'Se guarda en claro en el servidor del equipo: usa un apodo o código, no el nombre real.'],
    ['condicion', 'Pista', OPT_PISTA], ['temp_aire', 'Temp. aire (°C)', 'text'], ['temp_pista', 'Temp. pista (°C)', 'text'], ['neum_del', 'Neumático delantero', 'text', 'Marca / compuesto'], ['neum_tras', 'Neumático trasero', 'text', 'Marca / compuesto'], ['neum_vueltas', 'Vueltas del neumático', 'text']);
  return [
    { t: 'La sesión', fields: sesion },
    { t: 'Datos técnicos de la moto (para la suspensión)', hint: 'Recorrido físico = lo que mide la horquilla o el amortiguador de punta a punta (dato de la moto, no del sensor). Para que el «fondo de carrera» sea fiable, el cero del sensor tiene que ser la suspensión totalmente extendida (moto en soporte). Si lo que indicas no cuadra con lo que midió el sensor, la app avisa en rojo y NO calcula el fondo. Si no lo sabes, déjalo vacío: solo se calculan valores relativos. Después de analizar, mira «Rango del sensor» en la calidad de los datos: si nunca llega cerca del 100 % y sabes que sí topó, el recorrido está tecleado de más.', fields: [['travelF', 'Recorrido físico horquilla (mm)', 'text', 'Si no lo sabes, déjalo vacío'], ['travelR', 'Recorrido físico amortiguador (mm)', 'text', 'Si no lo sabes, déjalo vacío'], ['rpmLimite', 'RPM del limitador (opcional)', 'text', 'Ej.: 13500', 'Sin este dato no se calcula el tiempo al limitador.'], ['aguaAviso', 'Temperatura de aviso del agua (°C, opcional)', 'text', 'Ej.: 105', 'Sin este dato la app solo informa de si el agua sigue subiendo; no avisa por nivel.']] },
    { t: 'Qué cambiaste', fields: [['cambio', '¿Qué cambiaste desde la sesión anterior?', 'area', 'Una sola cosa por vez es lo ideal', 'Este texto se envía a la IA y se guarda en claro en el servidor: sin nombres de menores ni datos personales.'], ['notas', 'Notas', 'area', '', 'Se guardan en claro en el servidor del equipo.']] }
  ];
}
function setupFields() {
  if (ST.perfil === '2d-moto4') return [['horq_muelle', 'Muelle horquilla (N/mm)'], ['horq_nivel', 'Nivel de aceite horquilla (mm)'], ['horq_precarga', 'Precarga horquilla'], ['amort_muelle', 'Muelle amortiguador (N/mm)'], ['amort_precarga', 'Precarga amortiguador'], ['altura_tras', 'Altura trasera'], ['pinon', 'Piñón (dientes)'], ['corona', 'Corona (dientes)'], ['pres_del', 'Presión delantera (bar)'], ['pres_tras', 'Presión trasera (bar)'], ['pastillas', 'Pastillas']];
  return [['horq_precarga', 'Horquilla: precarga'], ['horq_comp', 'Horquilla: compresión'], ['horq_ext', 'Horquilla: extensión'], ['horq_nivel', 'Horquilla: nivel de aceite'], ['amort_precarga', 'Amortiguador: precarga'], ['amort_comp_alta', 'Amort.: compresión alta'], ['amort_comp_baja', 'Amort.: compresión baja'], ['amort_ext', 'Amort.: extensión'], ['altura_del', 'Altura delantera'], ['altura_tras', 'Altura trasera'], ['pinon', 'Piñón'], ['corona', 'Corona'], ['pres_del', 'Presión delantera (bar)'], ['pres_tras', 'Presión trasera (bar)'], ['mapa', 'Mapa'], ['tc', 'Control de tracción'], ['ebc', 'Freno motor (EBC)'], ['dwc', 'DWC'], ['dsc', 'DSC']];
}
function fieldHTML(group, f, P) {
  const k = f[0], v = (group === 'meta' ? P.meta : P.setup)[k] || '', t = f[2], bind = 'data-bind="' + group + '.' + k + '"', hint = f[4] ? '<span class="fh">' + esc(f[4]) + '</span>' : '';
  if (Array.isArray(t)) return '<label class="f">' + esc(f[1]) + '<select ' + bind + '>' + t.map(o => { const val = Array.isArray(o) ? o[0] : o, lb = Array.isArray(o) ? o[1] : o; return '<option value="' + esc(val) + '"' + (val === v ? ' selected' : '') + '>' + esc(lb || '—') + '</option>'; }).join('') + '</select>' + hint + '</label>';
  if (t === 'area') return '<label class="f span2">' + esc(f[1]) + '<textarea ' + bind + ' placeholder="' + esc(f[3] || '') + '">' + esc(v) + '</textarea>' + hint + '</label>';
  return '<label class="f">' + esc(f[1]) + '<input ' + bind + ' type="' + (t === 'date' ? 'date' : 'text') + '" value="' + esc(v) + '" placeholder="' + esc(f[3] || '') + '">' + hint + '</label>';
}
function renderCargar() {
  const P = PS(), PFl = PF();
  $('profInfo').innerHTML = '<b>' + esc(PFl.titulo) + '</b><br><span class="hint">' + esc(PFl.archivo) + '</span><br><span class="hint">' + esc(PFl.reglamento) + '</span>';
  $('fichaForm').innerHTML = fichaGroups().map(g => '<h3 class="gh">' + esc(g.t) + '</h3>' + (g.hint ? '<p class="hint gp">' + esc(g.hint) + '</p>' : '') + '<div class="grid">' + g.fields.map(f => fieldHTML('meta', f, P)).join('') + '</div>').join('');
  $('setupForm').innerHTML = setupFields().map(f => fieldHTML('setup', f, P)).join('');
  $('fileSub').textContent = PFl.exportacion;
  renderFileInfo(); renderMapping();
}
function renderFileInfo() {
  const P = PS(); const el = $('fileInfo'); if (!P.table) { el.innerHTML = ''; return; }
  const t = P.table, selD = P.parse.delimiter, selC = P.parse.decimal;
  el.innerHTML = '<div class="chips"><span class="chip ok">' + esc(P.fileName) + '</span><span class="chip">' + fmtN(t.n) + ' filas</span><span class="chip">' + t.names.length + ' columnas</span>' + (t.preamble && t.preamble.length ? '<span class="chip">' + t.preamble.length + ' líneas previas</span>' : '') + '</div>' +
    '<div class="row" style="margin-top:10px"><label class="f" style="min-width:150px">Separador (detectado «' + (t.delimiter === '\t' ? 'tab' : esc(t.delimiter)) + '»)<select data-parse="delimiter" aria-label="Separador de columnas">' + [['', 'Automático'], [';', 'Punto y coma ;'], [',', 'Coma ,'], ['\t', 'Tabulador'], ['|', 'Barra |']].map(o => '<option value="' + esc(o[0]) + '"' + (selD === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select></label>' +
    '<label class="f" style="min-width:150px">Decimal (detectado «' + esc(t.decimal) + '»)<select data-parse="decimal" aria-label="Separador decimal">' + [['', 'Automático'], [',', 'Coma ,'], ['.', 'Punto .']].map(o => '<option value="' + esc(o[0]) + '"' + (selC === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select></label><span class="hint">Si ves pocas filas o números raros, fuerza el separador o el decimal.</span></div>' +
    (t.warnings.length ? t.warnings.map(w => '<div class="note atencion">' + esc(w) + '</div>').join('') : '') + (P.mapMsg ? '<div class="note info">' + esc(P.mapMsg) + '</div>' : '');
}
function mapKey() {
  const P = PS(), f = P.meta;
  if (ST.perfil === 'i2m-ducati') return 'map2:i2m-ducati:' + (f.moto || 'sin-moto');
  return 'map2:2d-moto4:' + (f.unidad ? 'u' + f.unidad : 'sin-moto');
}
function mapOwnerOk() { const f = PS().meta; return ST.perfil === 'i2m-ducati' ? !!f.moto : !!f.unidad; }
function dupCols(P) { const d = {}; Object.keys(P.mapping).forEach(k => { const c = P.mapping[k].col; (d[c] = d[c] || []).push(k); }); return Object.keys(d).filter(c => d[c].length > 1).map(c => ({ col: +c, canales: d[c] })); }
function pendConfirm(P) { return Object.keys(P.mapping).filter(k => P.mapping[k].confirmar && !P.mapping[k].confirmado); }
function renderMapping() {
  const P = PS(), pan = $('mapPanel'), go = $('goRow'); if (!P.table) { pan.classList.add('hidden'); go.classList.add('hidden'); return; }
  pan.classList.remove('hidden'); go.classList.remove('hidden');
  const t = P.table, prof = PF(); const keys = Object.keys(prof.canales);
  const order = { incluido: 0, can: 0, opcional: 1, analogico: 1, fuera: 2 };
  keys.sort((a, b) => (order[prof.canales[a].kit] - order[prof.canales[b].kit]) || (Object.keys(C.CANALES).indexOf(a) - Object.keys(C.CANALES).indexOf(b)));
  const MS = C.mapStats(t, P.mapping), used = {}; Object.keys(P.mapping).forEach(k => { used[P.mapping[k].col] = k; });
  const opts = (sel, canon) => '<option value="">— sin enlazar —</option>' + t.names.map((n, i) => t.numeric[i] ? '<option value="' + i + '"' + (sel === i ? ' selected' : '') + '>' + esc(n) + (t.units[i] ? ' [' + esc(t.units[i]) + ']' : '') + (used[i] && used[i] !== canon ? ' (ya usada en ' + esc(lbl(used[i])) + ')' : '') + '</option>' : '').join('');
  const rowOf = k => {
    const m = P.mapping[k], c = C.CANALES[k], kit = prof.canales[k].kit; const isS = k === 'susp_f' || k === 'susp_r', ms = MS[k];
    let est = '', extra = '';
    if (m) {
      est = '<span class="badge ' + esc(m.conf || 'manual') + '">' + esc((m.confirmar && !m.confirmado && (m.conf || 'manual') === 'manual') ? 'manual · por confirmar' : (m.conf || 'manual')) + '</span> <span class="hint">' + esc(m.unit || '') + '</span>';
      if (ms) est += '<div class="obs">Observado: ' + fmtN(ms.min, 1) + ' a ' + fmtN(ms.max, 1) + ' ' + esc(c ? c.unit : '') + '</div>' + (ms.aviso ? '<div class="note atencion">' + esc(ms.aviso) + '</div>' : '');
      if (m.confirmar && !m.confirmado) est += '<label class="chip" style="margin-top:6px"><input type="checkbox" data-conf="' + k + '" aria-label="Confirmo que la columna ' + esc(m.name) + ' es ' + esc(lbl(k)) + '"> Confirmo que «' + esc(m.name) + '» es ' + esc(lbl(k)) + '</label><div class="hint">Enlazada por posición (nombre genérico): no se analiza hasta confirmarla.</div>';
      extra = '<div class="cv"><label class="f">Factor<input data-mapf="' + k + ':factor" value="' + esc(m.factor) + '" inputmode="decimal" aria-label="Factor de ' + esc(lbl(k)) + '"></label><label class="f">Suma<input data-mapf="' + k + ':offset" value="' + esc(m.offset) + '" inputmode="decimal" aria-label="Suma de ' + esc(lbl(k)) + '"></label>';
      if (isS) {
        extra += '<label class="f">Lectura<select data-mapf="' + k + ':mode" aria-label="Lectura de ' + esc(lbl(k)) + '"><option value="mm"' + (!m.mode || m.mode === 'mm' ? ' selected' : '') + '>Ya está en mm</option><option value="pct"' + (m.mode === 'pct' ? ' selected' : '') + '>Es % del recorrido</option><option value="cal"' + (m.mode === 'cal' ? ' selected' : '') + '>Calibrar con 2 puntos</option></select></label>';
        if (m.mode === 'cal') extra += '<label class="f">Valor en extensión total<input data-mapf="' + k + ':raw0" value="' + esc(m.raw0 == null ? '' : m.raw0) + '" inputmode="decimal"></label><label class="f">Valor en compresión total<input data-mapf="' + k + ':raw1" value="' + esc(m.raw1 == null ? '' : m.raw1) + '" inputmode="decimal"></label>';
        else extra += '<label class="chip"><input type="checkbox" data-mapf="' + k + ':invert"' + (m.invert ? ' checked' : '') + '> Invertir</label>';
      }
      extra += '</div>';
      if (!isS) { const dflt = +m.factor === 1 && !(+m.offset); extra = '<details class="cvd"' + (dflt ? '' : ' open') + '><summary>Conversión: × ' + esc(m.factor) + (+m.offset ? ' + ' + esc(m.offset) : '') + (dflt ? ' (sin cambios)' : '') + '</summary>' + extra + '</details>'; }
    }
    return '<tr><td data-l="Canal"><b>' + esc(c ? c.label : k) + '</b> <span class="hint">' + esc(c ? c.unit : '') + '</span></td><td data-l="Origen"><span class="badge">' + esc(KITLBL[kit] || kit) + '</span></td><td data-l="Columna del archivo" style="min-width:200px"><select data-map="' + k + '" aria-label="Columna para ' + esc(c ? c.label : k) + '">' + opts(m ? m.col : null, k) + '</select></td><td data-l="Estado y rango observado">' + est + '</td><td data-l="Conversión">' + extra + '</td></tr>';
  };
  // los canales sin enlazar que no son básicos del kit se pliegan: la pantalla de carga no debe medir once pantallas en el teléfono
  const visible = k => P.mapping[k] || prof.canales[k].kit === 'incluido' || prof.canales[k].kit === 'analogico';
  const rows = keys.filter(visible).map(rowOf).join(''), rowsHid = keys.filter(k => !visible(k)).map(rowOf).join(''), nHid = keys.filter(k => !visible(k)).length;
  const THEAD = '<thead><tr><th>Canal</th><th>Origen</th><th>Columna del archivo</th><th>Estado y rango observado</th><th>Conversión</th></tr></thead>';
  const usedSet = new Set(Object.keys(P.mapping).map(k => P.mapping[k].col)); if (P.mapping.lap) usedSet.add(P.mapping.lap.col);
  const sobrantes = t.names.filter((n, i) => t.numeric[i] && !usedSet.has(i));
  const dups = dupCols(P), pend = pendConfirm(P);
  pan.querySelector('#mapBody').innerHTML =
    (dups.length ? '<div class="banner bad">' + dups.map(d => 'La columna «' + esc(t.names[d.col]) + '» está enlazada a ' + d.canales.map(x => esc(lbl(x))).join(' y ') + ': cada canal necesita su propia columna.').join('<br>') + '</div>' : '') +
    (pend.length ? '<div class="banner warn">Hay ' + pend.length + ' canal(es) enlazado(s) por posición (' + pend.map(x => esc(lbl(x))).join(', ') + '). Mira el rango observado de cada uno y confírmalos antes de analizar.' + (pend.length > 2 ? ' <button class="btn sm" data-act="confirmAll">He mirado el rango de estos ' + pend.length + ' y son correctos</button>' : '') + '</div>' : '') +
    '<div class="tw"><table class="maptbl">' + THEAD + '<tbody>' + rows + '</tbody></table></div>' +
    (nHid ? '<details style="margin-top:12px"><summary>Canales sin enlazar (' + nHid + '): ábrelos si tu archivo trae alguno</summary><div class="tw"><table class="maptbl">' + THEAD + '<tbody>' + rowsHid + '</tbody></table></div></details>' : '') +
    (!P.mapping.t ? '<div class="banner warn" style="margin-top:10px">No hay columna de tiempo enlazada. Elígela arriba o indica la frecuencia de muestreo: <input data-bind="top.hz" value="' + esc(P.hz) + '" placeholder="Hz" inputmode="decimal" style="width:100px" aria-label="Frecuencia de muestreo en Hz"></div>' : '') +
    (sobrantes.length ? '<details style="margin-top:12px"><summary>Columnas del archivo sin usar (' + sobrantes.length + ')</summary><div class="in hint">' + sobrantes.map(esc).join(' · ') + '</div></details>' : '') +
    '<div class="row" style="margin-top:12px"><button class="btn sm" data-act="saveMap">Guardar este mapeo para ' + (ST.perfil === 'i2m-ducati' ? 'esta moto' : 'esta moto de la flota') + '</button><button class="btn sm" data-act="applyMap">Aplicar el mapeo guardado de esta moto</button><span class="hint" id="mapSaveMsg" role="status"></span></div>' +
    '<p class="hint">El mapeo guardado incluye los factores y calibraciones de ESTA moto: no se comparte con las demás.</p>';
  renderGoHint();
}
function renderGoHint() { const P = PS(); const el = $('goHint'); if (!el) return; const pf = P.table ? preflight(P) : []; el.textContent = pf.length ? pf[0] + (pf.length > 1 ? ' (+' + (pf.length - 1) + ' más)' : '') : ''; }
function preflight(P) {
  const out = [], t = P.table; if (!t) return ['Carga un archivo.'];
  dupCols(P).forEach(d => out.push('La columna «' + t.names[d.col] + '» está enlazada a ' + d.canales.map(lbl).join(' y ') + '.'));
  Object.keys(P.mapping).forEach(k => { const m = P.mapping[k]; if (!(+m.factor > 0)) out.push('El factor de «' + lbl(k) + '» debe ser mayor que 0 (para dar la vuelta a la suspensión usa «Invertir»).'); });
  pendConfirm(P).forEach(k => out.push('Confirma el canal «' + lbl(k) + '» (columna «' + P.mapping[k].name + '», enlazada por posición).'));
  { const rl = String(P.meta.rpmLimite == null ? '' : P.meta.rpmLimite).trim(); if (rl && !(numRpm(rl) >= 1000)) out.push('El límite de RPM «' + rl + '» parece mal escrito (¿13 500?). Corrígelo o déjalo vacío.'); }
  if (!P.mapping.t && !(num(P.hz) > 0)) out.push('Falta la columna de tiempo o la frecuencia (Hz).');
  return out;
}
async function loadFile(file) {
  const P = PS(); busy('Leyendo ' + file.name + '…');
  try {
    const buf = await file.arrayBuffer(); let text, enc = 'utf-8';
    const b0 = new Uint8Array(buf.slice(0, 2));
    if (b0[0] === 0xFF && b0[1] === 0xFE) { text = new TextDecoder('utf-16le').decode(buf); enc = 'utf-16le'; } /* «Texto Unicode» de Excel */
    else if (b0[0] === 0xFE && b0[1] === 0xFF) { text = new TextDecoder('utf-16be').decode(buf); enc = 'utf-16be'; }
    else { try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { text = new TextDecoder('windows-1252').decode(buf); enc = 'windows-1252'; } }
    P.hash = await C.sha256bytes(buf); await nextFrame();
    await useText(text, file.name, file.size, enc);
  } catch (e) { toast('No se pudo leer el archivo: ' + e.message, 'err'); } finally { busy(''); }
}
async function useText(text, name, size, enc) {
  const P = PS(); const nuevo = P.fileName !== name || P.text !== text; const habiaAntes = nuevo && P.text != null;
  P.text = text; P.fileName = name; P.fileSize = size; P.override = {}; P.A = null; P.ai = null; P.saved = null; P.reglas = []; P.snap = null; P.dirty = false; P.recId = null; P.pendId = null; P.runId = 0; P.chartLaps = []; P.parse = { delimiter: '', decimal: '' }; P.hz = '';
  let aviso = '';
  if (nuevo && P.meta.cambio && P.meta.cambio === P.lastCambioSaved) { P.meta.cambio = ''; aviso = ' Se vació «¿Qué cambiaste?» porque era el texto de la sesión anterior.'; renderCargar(); }
  if (habiaAntes) { /* otro archivo: solo se vacía lo que la ficha heredó de la sesión ya guardada; lo que escribiste después se respeta */
    P.base = null; const her = P.heredada || null, vac = [];
    if (her) SES_KEYS.forEach(k => { if (P.meta[k] && P.meta[k] === her[k] && !(P.tocados && P.tocados.has(k))) { vac.push(k); P.meta[k] = ''; } });
    P.heredada = null; P.tocados = new Set(); const quedan = SES_KEYS.filter(k => P.meta[k]);
    aviso += ' Es otro archivo.' + (vac.length ? ' Se vaciaron (eran de la sesión anterior): ' + vac.map(k => SES_NOM[k]).join(', ') + '.' : '') + (quedan.length ? ' Siguen como los dejaste: ' + quedan.map(k => SES_NOM[k]).join(', ') + '.' : '') + ' Revisa lo que se conserva: circuito, moto, piloto, neumáticos y reglaje. Se quitó la sesión base.'; renderCargar();
  }
  P.mapMsg = (enc === 'utf-16le' || enc === 'utf-16be' ? 'El archivo estaba en UTF-16 (el «Texto Unicode» de Excel): se leyó bien.' : enc !== 'utf-8' ? 'El archivo no era UTF-8: se leyó como Windows-1252.' : '') + aviso;
  if (!P.hash) P.hash = await C.sha256hex(text);
  await reparse(true);
}
async function reparse(primera) {
  const P = PS(); if (P.text == null) return;
  const o = {}; if (P.parse.delimiter) o.delimiter = P.parse.delimiter; if (P.parse.decimal) o.decimal = P.parse.decimal;
  P.table = C.parseTable(P.text, o); P.mapping = C.autoMap(ST.perfil, P.table); P.A = null; P.ai = null; P.snap = null; P.dirty = false; P.reglas = [];
  let msg = primera ? P.mapMsg : (P.mapMsg || '');
  if (mapOwnerOk()) { const n = await applySavedMapping(P); if (n) msg += (msg ? ' ' : '') + 'Se aplicó el mapeo guardado de esta moto (' + n + ' canales). Mira el rango observado: si cambiaste un sensor, recalíbralo.'; }
  else msg += (msg ? ' ' : '') + 'Elige la moto en la ficha para aplicar o guardar su mapeo.';
  P.mapMsg = msg;
  if (P.fichaRecordada) { P.fichaRecordada = false; P.mapMsg += ' Se rellenaron el recorrido y los demás datos técnicos con los guardados de esta moto: compruébalos en la ficha.'; renderCargar(); } else { renderFileInfo(); renderMapping(); }
}
async function applySavedMapping(P) {
  let rec = null; try { rec = parseVal(await kvGet(mapKey())); } catch (e) { return 0; }
  if (!rec || !rec.canales) return 0; let n = 0; const nm = C._u.norm;
  // recorrido, RPM y aviso de agua de esta moto: solo se rellenan si la ficha los tiene vacíos
  if (rec.ficha && typeof rec.ficha === 'object') { let ch = false; ['travelF', 'travelR', 'rpmLimite', 'aguaAviso'].forEach(k => { const v = rec.ficha[k]; if (!P.meta[k] && v != null && /^[0-9.,]{1,12}$/.test(String(v))) { P.meta[k] = String(v); ch = true; } }); if (ch) P.fichaRecordada = true; }
  Object.keys(rec.canales).forEach(canon => {
    if (!PF().canales[canon]) return; const m = rec.canales[canon]; if (!m || !(+m.factor > 0)) return;
    const ci = P.table.names.findIndex((x, i) => P.table.numeric[i] && nm(x) === nm(m.name)); if (ci < 0) return;
    if (Object.keys(P.mapping).some(k => k !== canon && P.mapping[k].col === ci)) delete P.mapping[Object.keys(P.mapping).find(k => k !== canon && P.mapping[k].col === ci)];
    P.mapping[canon] = { col: ci, name: P.table.names[ci], conf: 'alta', unit: m.unit, factor: +m.factor, offset: +m.offset || 0, invert: !!m.invert, mode: m.mode || '', raw0: m.raw0, raw1: m.raw1, confirmado: true }; n++;
  }); return n;
}
async function saveMapping() {
  const P = PS(); if (!P.table) return;
  if (!mapOwnerOk()) { toast('Elige primero la moto en la ficha: el mapeo se guarda por moto.', 'err'); return; }
  const pf = preflight(P); if (pf.length) { toast('Antes de guardar el mapeo: ' + pf[0], 'err'); return; }
  const c = {}; Object.keys(P.mapping).forEach(k => { const m = P.mapping[k]; c[k] = { name: m.name || P.table.names[m.col], unit: m.unit, factor: m.factor, offset: m.offset, invert: !!m.invert, mode: m.mode || '', raw0: m.raw0, raw1: m.raw1 }; });
  const fi = {}; ['travelF', 'travelR', 'rpmLimite', 'aguaAviso'].forEach(k => { if (P.meta[k]) fi[k] = String(P.meta[k]).slice(0, 12); });
  try { await kvSetVerified(mapKey(), JSON.stringify({ v: 2, perfil: ST.perfil, clave: mapKey(), guardado: new Date().toISOString(), canales: c, ficha: fi })); $('mapSaveMsg').textContent = 'Mapeo guardado y verificado ✓ (' + mapKey().replace('map2:', '') + ')'; }
  catch (e) { $('mapSaveMsg').textContent = ''; toast('No se guardó el mapeo: ' + e.message, 'err'); }
}
function markDirty() { const P = PS(); if (P.A) { P.dirty = true; if (ST.tab === 'analisis') renderAnalysis(); } renderGoHint(); }
function onMapCol(canon, val) {
  const P = PS(); if (val === '') { delete P.mapping[canon]; markDirty(); renderMapping(); return; }
  const ci = +val, t = P.table; const otro = Object.keys(P.mapping).find(k => k !== canon && P.mapping[k].col === ci);
  if (otro) { toast('Esa columna ya está enlazada a «' + lbl(otro) + '». Desenlázala primero.', 'err'); renderMapping(); return; }
  const st = { max: (function () { let m = -Infinity; const c = t.cols[ci]; for (let i = 0; i < c.length; i += Math.max(1, (c.length / 500) | 0)) if (c[i] > m) m = c[i]; return m; })() };
  let cv = C.suggestConv(canon, t.units[ci], st.max);
  if (canon === 't') { const d = []; const c = t.cols[ci]; for (let i = 1; i < Math.min(c.length, 2000); i++) { const x = c[i] - c[i - 1]; if (x > 0) d.push(x); } d.sort((a, b) => a - b); const md = d[d.length >> 1]; if (/^ms$/i.test(t.units[ci] || '') || (!t.units[ci] && md >= 2)) cv = { factor: 0.001, offset: 0, unit: 'ms' }; else cv = { factor: 1, offset: 0, unit: 's' }; }
  P.mapping[canon] = { col: ci, name: t.names[ci], conf: 'manual', unit: cv.unit, factor: cv.factor, offset: cv.offset, invert: false, confirmado: true };
  markDirty(); renderMapping();
}
function onMapField(canon, field, el) {
  const m = PS().mapping[canon]; if (!m) return;
  if (field === 'invert') m.invert = el.checked;
  else if (field === 'mode') { m.mode = el.value; m.conf = 'manual'; m.confirmado = true; markDirty(); renderMapping(); return; }
  else {
    const v = num(el.value); if (v != null && (!isFinite(v) || Math.abs(v) > 1e9)) { toast('Ese número no es válido.', 'err'); renderMapping(); return; }
    if (field === 'factor') { if (!(v > 0)) { toast('El factor debe ser un número mayor que 0 (para dar la vuelta a la suspensión usa «Invertir»).', 'err'); renderMapping(); return; } m.factor = v; }
    else if (field === 'offset') m.offset = v == null ? 0 : v; else m[field] = v;
  }
  m.conf = 'manual'; markDirty(); renderMapping(); /* tocar el factor o el offset NO confirma un canal enlazado por posición: eso solo lo hace su casilla */
}
function confirmAll() { const P = PS(); pendConfirm(P).forEach(k => { P.mapping[k].confirmado = true; }); markDirty(); renderMapping(); }
function onMapConf(canon, el) { const m = PS().mapping[canon]; if (!m) return; m.confirmado = !!el.checked; markDirty(); renderMapping(); }
function metaForCalc() { const P = PS(); return { travelF: num(P.meta.travelF), travelR: num(P.meta.travelR), hz: num(P.hz), rpmLimite: numRpm(P.meta.rpmLimite), aguaAviso: num(P.meta.aguaAviso) }; }
async function runAnalysis(keepTab) {
  const P = PS(); if (!P.table) return false;
  const pf = preflight(P); if (pf.length) { toast(pf[0], 'err'); renderMapping(); return false; }
  busy('Calculando…'); await nextFrame();
  try {
    const mc = metaForCalc();
    const A = C.analyze(P.table, P.mapping, mc, ST.perfil, { override: P.override });
    if (A.error) { toast(A.error, 'err'); return false; }
    P.runId++; A.runId = P.runId; P.A = A; P.reglas = C.reglas(A, mc, ST.perfil); A.reglasDisparadas = P.reglas; P.saved = null; P.dirty = false;
    P.snap = { mapping: JSON.parse(JSON.stringify(P.mapping)), calc: mc, override: Object.assign({}, P.override), archivo: P.fileName, bytes: P.fileSize, sha256: P.hash };
    if (!P.chartLaps.length) { const v = A.vueltas.filter(l => l.valida && !l.sinVueltas); if (v.length) { const best = v.reduce((a, b) => b.tiempo < a.tiempo ? b : a); P.chartLaps = [best.num]; } }
    if (!keepTab) setTab('analisis'); else renderAnalysis();
    return true;
  } catch (e) { toast('Error al analizar: ' + e.message, 'err'); return false; } finally { busy(''); }
}

/* ===================== pestaña ANÁLISIS ===================== */
function metricRow(id, v) { const k = id.replace(/^(S|L\d+)\./, ''), d = C.MDEF[k]; return '<tr><td>' + esc(d ? d.l : k) + '</td><td class="num">' + fmtN(v, d ? Math.max(d.d, 0) : 2) + ' <span class="hint">' + esc(d ? d.u : '') + '</span></td></tr>'; }
function evChips(ev) { return ev && ev.length ? '<div class="ev">' + ev.map(e => '<span title="' + esc(e.id) + '">' + esc(C.metricLabel(e.id)) + ': ' + fmtN(e.valor, 2) + ' ' + esc(C.metricUnit(e.id)) + '</span>').join('') + '</div>' : ''; }
const NIVEL_ORD = { alerta: 0, atencion: 1, info: 2 };
function metaCmp(f) { f = f || {}; return { circuito: f.circuito, moto: f.unidad || f.moto, condicion: f.condicion, neumatico: [f.neum_del, f.neum_tras].filter(Boolean).join('/'), piloto: f.piloto }; }
function sensOf(P) { const s = num(P.sens); return Math.min(100, Math.max(1, s == null ? 10 : s)) / 100; }
function baseCompare(P) {
  if (!P.A || !P.base) return null; const b = P.base.rec;
  const comp = C.comparabilidad(metaCmp(P.meta), metaCmp(b.ficha), P.A.hz, b.resumen && b.resumen.hz);
  const cambios = comp.ok ? C.compareMetrics(P.A.metricas, b.metricas, { sens: sensOf(P), hzDistinto: comp.hzDistinto }) : null;
  return { comp: comp, cambios: cambios };
}
function renderAnalysis() {
  destroyCharts();
  const P = PS(), A = P.A, el = $('anaBody');
  if (!A) { el.innerHTML = '<div class="banner">Todavía no hay análisis de ' + esc(PF().etiqueta) + '. Carga un archivo en la pestaña 1.</div>'; return; }
  const M = A.metricas, validas = A.vueltas.filter(l => l.valida && !l.sinVueltas), best = validas.length ? validas.reduce((a, b) => b.tiempo < a.tiempo ? b : a) : null;
  const sinVueltas = A.vueltas.length > 0 && A.vueltas.every(l => l.sinVueltas);
  const stat = (k, v, u) => '<div class="stat"><div class="k">' + k + '</div><div class="v">' + v + ' <span class="u">' + u + '</span></div></div>';
  let h = '';
  if (P.dirty) h += '<div class="banner warn" role="alert">Cambiaste algo que afecta al cálculo (canales, recorrido, frecuencia, RPM del limitador). Lo que ves es del cálculo anterior y no se puede guardar. <button class="btn sm pri" data-act="recalc">Recalcular</button></div>';
  h += '<div class="stats">' + stat('Mejor vuelta', best ? fmtLap(best.tiempo) : '—', '') + stat('Vueltas válidas', validas.length, 'de ' + A.vueltas.filter(l => !l.sinVueltas).length) + stat('Vel. máxima', fmtN(M['S.vmax'], 0), 'km/h') + stat('Frecuencia', fmtN(A.hz, 1), 'Hz') + stat('Duración', fmtN(A.dur / 60, 1), 'min') + '</div>';
  if (P.ai && P.ai.runId !== P.runId) h += '<div class="banner warn">La lectura de la IA de abajo corresponde a un cálculo anterior (cambiaron las vueltas incluidas o los datos). No se guarda: vuelve a pedirla.</div>';
  if (A.metodoVueltas === 'puerta GPS automática') h += '<div class="banner">Las vueltas se cortaron con una puerta automática en el punto de más velocidad. Sirven para comparar vueltas entre sí; no coinciden con el cronometraje oficial.</div>';
  if (sinVueltas) h += '<div class="banner warn">No se detectaron vueltas en este archivo (se trató como un solo tramo). Se puede guardar, pero no entra en la comparación de «mejor vuelta».</div>';
  const cal = A.calidad.slice().sort((a, b) => (NIVEL_ORD[a.nivel] - NIVEL_ORD[b.nivel])), nAl = cal.filter(c => c.nivel === 'alerta').length;
  h += '<details open><summary>Calidad de los datos (' + cal.length + (nAl ? ' · ' + nAl + ' en rojo' : '') + ')</summary><div class="in">' + cal.map(c => '<div class="note ' + esc(c.nivel) + '">' + (c.nivel === 'alerta' ? '<b>REVISAR: </b>' : '') + esc(c.texto) + '</div>').join('') + '</div></details>';
  /* vueltas */
  const cols = [['vmax', 'Vel. máx.', 0], ['gas_pleno_pct', 'Gas pleno %', 1], ['freno_d_pmax', 'Freno máx. (bar)', 0], ['susp_f_media_pct', 'Horq. media %', 1], ['susp_r_media_pct', 'Amort. media %', 1], ['susp_f_fondo_n', 'Fondo horq.', 0], ['susp_r_fondo_n', 'Fondo amort.', 0], ['patinaje_max', 'Patin. máx. %', 1], ['bloqueo_del_n', 'Bloqueo del.', 0]].filter(c => A.tabla.some(r => r.m && isN(r.m[c[0]])));
  const bt = best ? best.tiempo : null;
  h += '<div class="panel"><h2>Vueltas</h2><p class="sub">Marca o desmarca para decidir qué vueltas cuentan. Se recalcula al instante.</p><div class="tw"><table><thead><tr><th>Cuenta</th><th>Vuelta</th><th class="num">Tiempo</th><th class="num">Dif. mejor</th><th>Estado</th>' + cols.map(c => '<th class="num">' + c[1] + '</th>').join('') + '</tr></thead><tbody>' +
    A.tabla.map((r, i) => { const l = A.vueltas[i]; const off = !r.valida; return '<tr class="' + (off ? 'off' : '') + '"><td>' + (l.sinVueltas ? '' : '<label class="lapc"><input type="checkbox" data-lap="' + r.num + '" aria-label="Contar la vuelta ' + r.num + '"' + (r.valida ? ' checked' : '') + '></label>') + '</td><td>' + r.num + (l.marca != null && l.marca !== r.num ? ' <span class="hint">(logger: ' + esc(l.marca) + ')</span>' : '') + '</td><td class="num">' + (l.sinVueltas ? '—' : fmtLap(r.tiempo)) + '</td><td class="num">' + (bt != null && r.valida && !l.sinVueltas ? '+' + (r.tiempo - bt).toFixed(3) : '') + '</td><td>' + (l.sinVueltas ? '<span class="chip warn">sin vueltas</span>' : r.valida ? '<span class="chip ok">válida</span>' : '<span class="chip warn" title="' + esc(r.motivo || '') + '">' + esc(r.motivo || 'no cuenta') + '</span>') + (l.parcial ? ' <span class="chip">parcial</span>' : '') + '</td>' + cols.map(c => '<td class="num">' + (r.m && isN(r.m[c[0]]) ? fmtN(r.m[c[0]], c[2]) : '') + '</td>').join('') + '</tr>'; }).join('') + '</tbody></table></div></div>';
  /* alertas */
  if (P.reglas.length) h += '<div class="panel"><h2>Alertas del equipo (umbrales provisionales)</h2><p class="sub">Los umbrales los fijó quien programó la app, sin calibrarlos con vuestra flota: sirven para llamar la atención, no para diagnosticar. Son hipótesis a probar.</p>' + P.reglas.map(r => '<div class="card ' + (r.severidad === 'atencion' ? 'warn' : '') + '"><div class="t">' + esc(r.titulo) + ' <span class="badge">' + esc(r.estado) + '</span></div><div class="d">' + esc(r.texto) + '</div><div class="hint" style="margin-top:4px">Umbral: ' + esc(r.umbral || '—') + '</div>' + evChips(r.evidencia.map(id => ({ id: id, valor: M[id] }))) + '</div>').join('') + '</div>';
  h += renderBasePanel();
  /* IA */
  const stale = !!(P.ai && P.ai.runId !== P.runId);
  h += '<div class="panel"><h2>Lectura del telemetrista IA</h2><p class="sub">La IA recibe cifras calculadas aquí, tu reglaje y lo que escribas en «¿Qué cambiaste?» (no el archivo ni el campo Piloto). La app comprueba que cada cifra citada exista entre las métricas y descarta los hallazgos sin ninguna métrica coherente con su tema. NO comprueba que la conclusión sea correcta: son hipótesis a probar.</p><div class="row"><button class="btn pri" data-act="askAI"' + (P.dirty ? ' disabled' : '') + '>' + (P.ai ? 'Pedir de nuevo' : 'Pedir lectura') + '</button><span class="hint">' + (aiBaseUsable(P) ? 'Se enviará la comparación con la sesión base elegida.' : 'Sin sesión base utilizable: lectura de una sola sesión, con confianza limitada.') + '</span></div><div id="aiOut" style="margin-top:12px">' + (P.ai ? aiHTML(P.ai, stale) : '') + '</div></div>';
  /* métricas */
  const groups = {}; Object.keys(M).filter(id => id.indexOf('S.') === 0 && !/_hist\d+$/.test(id)).forEach(id => { const k = id.slice(2), d = C.MDEF[k], g = d ? d.g : 'Otros'; (groups[g] = groups[g] || []).push([id, M[id]]); });
  h += '<div class="panel"><h2>Todas las cifras de la sesión</h2><p class="sub">Calculadas con las vueltas que cuentan.</p>' + Object.keys(groups).map(g => '<details><summary>' + esc(g) + ' (' + groups[g].length + ')</summary><div class="in"><table><tbody>' + groups[g].map(x => metricRow(x[0], x[1])).join('') + '</tbody></table></div></details>').join('') + '</div>';
  /* gráficos */
  const chans = ['gps_speed', 'v_rear', 'v_front', 'tps', 'rpm', 'brake_f', 'brake_r', 'susp_f', 'susp_r', 'lean', 'water_temp', 'lambda'].filter(k => A.S[k]);
  if (!validas.length) h += '<div class="panel"><h2>Gráficos</h2><div class="hint">Sin vueltas válidas no hay qué comparar en el gráfico por vuelta.</div></div>';
  else h += '<div class="panel"><h2>Gráficos</h2><div class="row"><label class="f" style="min-width:200px">Canal<select data-chart="ch" aria-label="Canal del gráfico">' + chans.map(k => '<option value="' + k + '"' + (P.chartCh === k ? ' selected' : '') + '>' + esc(C.CANALES[k].label) + '</option>').join('') + '</select></label><div class="row" id="chartLaps">' + validas.map(l => '<label class="chip"><input type="checkbox" data-chart="lap" value="' + l.num + '" aria-label="Mostrar la vuelta ' + l.num + '"' + (P.chartLaps.indexOf(l.num) >= 0 ? ' checked' : '') + '> V' + l.num + '</label>').join('') + '</div></div><div class="chartbox" style="margin-top:12px"><canvas id="cLap" aria-label="Gráfico del canal por vuelta" role="img"></canvas></div>' +
    (A.hist.susp_f || A.hist.susp_r ? '<h3 class="gh" style="margin-top:18px">Cuánto recorrido usa la suspensión (% del tiempo en cada tramo)</h3><div class="chartbox" style="height:220px"><canvas id="cHist" aria-label="Histograma de recorrido de la suspensión" role="img"></canvas></div>' : '') + '</div>';
  /* no verificable */
  h += '<div class="panel"><h2>No verificable con lo que está enlazado</h2><p class="sub">Para estas cifras falta un canal. La app no las inventa.</p>' + (A.noVerificable.length ? A.noVerificable.map(x => '<div class="note atencion"><b>' + esc(x.grupo) + '</b>: falta ' + esc(x.falta) + ' <span class="hint">(' + esc(x.metricas.slice(0, 4).join('; ')) + (x.metricas.length > 4 ? '…' : '') + ')</span></div>').join('') : '<div class="hint">Nada: todo lo previsto se pudo calcular.</div>') + '</div>';
  /* guardar */
  const yaGuardada = !!P.recId;
  h += '<div class="panel"><h2>Guardar</h2><p class="sub">Se guarda un resumen pequeño (cifras, vueltas, reglaje, lectura de la IA si está al día) en el servidor del equipo. Solo se confirma «guardado» si el servidor devuelve lo mismo que se envió.' + (yaGuardada ? ' Esta sesión ya está guardada: guardar otra vez la ACTUALIZA, no crea otra.' : '') + '</p><label class="chip" style="margin-bottom:10px"><input type="checkbox" id="saveOrig"' + (P.saveOrig ? ' checked' : '') + '> Subir también una copia del archivo original a Drive (pesa más; no hace falta para comparar sesiones)</label><div class="row"><button class="btn pri" data-act="save"' + (P.dirty ? ' disabled title="Recalcula antes de guardar"' : '') + '>' + (yaGuardada ? 'Actualizar sesión guardada' : 'Guardar sesión') + '</button><span id="saveMsg" class="hint" role="status">' + (P.saved ? 'Guardada y verificada: ' + esc(P.saved) : '') + '</span></div></div>';
  el.innerHTML = h; drawCharts();
}
function histOpts() { const P = PS(); const cur = P.recId ? 's2:' + ST.perfil + ':' + P.recId : null; return (ST.hist[ST.perfil] || []).filter(x => x.key !== cur); }
function aiBaseUsable(P) { const bc = baseCompare(P); return !!(bc && bc.comp.ok); }
function renderBasePanel() {
  const P = PS(), A = P.A, hs = histOpts(); let h = '<div class="panel"><h2>Comparar con una sesión base</h2><p class="sub">Con una base, los cambios dejan de ser «lecturas sueltas» y pasan a ser evidencia. Solo se comparan sesiones del mismo circuito y de la misma moto.</p>';
  if (!ST.histLoaded[ST.perfil]) h += '<div class="row"><button class="btn sm" data-act="loadHist">Cargar mis sesiones guardadas</button></div>';
  else if (!hs.length) h += '<div class="hint">Todavía no hay otras sesiones guardadas de este sistema.</div>';
  else {
    h += '<div class="row"><label class="f" style="min-width:260px">Sesión base<select data-bind="top.base" aria-label="Sesión base"><option value="">— sin base —</option>' + hs.map(x => '<option value="' + esc(x.key) + '"' + (P.base && P.base.key === x.key ? ' selected' : '') + '>' + esc((x.rec.ficha.fecha || (x.rec.creado || '').slice(0, 10)) + ' · ' + (x.rec.ficha.circuito || '—') + ' · ' + (x.rec.ficha.unidad ? 'moto ' + x.rec.ficha.unidad : (x.rec.ficha.moto || '')) + (x.rec.ficha.cambio ? ' · ' + x.rec.ficha.cambio.slice(0, 30) : '')) + '</option>').join('') + '</select></label><label class="f" style="width:130px">Sensibilidad (%)<input data-bind="top.sens" value="' + esc(P.sens) + '" inputmode="decimal" aria-label="Sensibilidad en porcentaje"></label></div>';
    const bc = baseCompare(P);
    if (bc) {
      if (!bc.comp.ok) h += '<div class="banner bad" style="margin-top:10px"><b>No se compara con esta base.</b><br>' + bc.comp.bloqueos.map(esc).join('<br>') + '</div>';
      if (bc.comp.avisos.length) h += '<div class="banner warn" style="margin-top:10px">' + bc.comp.avisos.map(esc).join('<br>') + '</div>';
      if (bc.cambios) h += (bc.cambios.length ? '<div class="tw" style="margin-top:10px"><table><thead><tr><th>Cifra</th><th class="num">Ahora</th><th class="num">Base</th><th class="num">Cambio</th></tr></thead><tbody>' + bc.cambios.map(c => '<tr><td>' + esc(C.metricLabel(c.id).replace('Sesión · ', '')) + (c.porVuelta ? ' <span class="hint">(por vuelta válida)</span>' : '') + '</td><td class="num">' + fmtN(c.actual, 2) + '</td><td class="num">' + fmtN(c.base, 2) + '</td><td class="num">' + (c.rel == null ? '—' : (c.rel > 0 ? '+' : '') + fmtN(c.rel, 1) + ' %') + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="hint" style="margin-top:8px">No hay cambios por encima de la sensibilidad elegida.</div>');
    }
  }
  return h + '</div>';
}
function aiHTML(ai, stale) {
  const v = ai.resultado; let h = '';
  if (ai.demo) h += '<div class="banner warn">Respuesta de ejemplo del modo demostración. No es una lectura real.</div>';
  if (stale) h += '<div class="note atencion">Esta lectura es de un cálculo anterior.</div>';
  h += '<div class="card pri"><div class="t">Resumen</div><div class="d">' + esc(v.resumen) + '</div>' + (v.resumenCifrasSinRespaldo && v.resumenCifrasSinRespaldo.length ? '<div class="note atencion">Cifras del resumen que no coinciden con las métricas citadas: ' + v.resumenCifrasSinRespaldo.map(x => fmtN(x, 2)).join(', ') + '. No te fíes de ellas.</div>' : '') + '</div>';
  if (v.prioridad) h += '<div class="card pri"><div class="t">Cambio que probaría primero</div><div class="d"><b>' + esc(v.prioridad.accion || '—') + '</b><br>' + esc(v.prioridad.por_que) + '</div>' + (v.prioridad.avisoReglamento ? '<div class="note alerta">' + esc(v.prioridad.avisoReglamento) + '</div>' : '') + (v.prioridad.avisoPilotaje ? '<div class="note alerta">' + esc(v.prioridad.avisoPilotaje) + '</div>' : '') + (v.prioridad.avisoLista ? '<div class="note atencion">' + esc(v.prioridad.avisoLista) + '</div>' : '') + (v.prioridad.sinRespaldo ? '<div class="note atencion">Sin cifras que lo respalden: tómalo como idea, no como hallazgo.</div>' : '') + (v.prioridad.cifrasSinRespaldo && v.prioridad.cifrasSinRespaldo.length ? '<div class="note atencion">Cifras escritas que no coinciden con las métricas citadas: ' + v.prioridad.cifrasSinRespaldo.map(x => fmtN(x, 2)).join(', ') + '.</div>' : '') + evChips(v.prioridad.evidencia) + '</div>';
  h += v.hallazgos.map(x => '<div class="card"><div class="t">' + esc(x.titulo) + ' <span class="badge ' + safeConf(x.confianza) + '">confianza ' + esc(safeConf(x.confianza)) + (x.confianzaLimitada ? ' (limitada: sin base)' : '') + '</span> <span class="badge">' + esc(okCat(x.categoria)) + '</span></div><div class="d">' + esc(x.interpretacion) + '</div>' + (x.accion ? '<div class="d" style="margin-top:6px"><b>A probar:</b> ' + esc(x.accion) + '</div>' : '') + (x.avisoReglamento ? '<div class="note alerta">' + esc(x.avisoReglamento) + '</div>' : '') + (x.avisoPilotaje ? '<div class="note alerta">' + esc(x.avisoPilotaje) + '</div>' : '') + (x.avisoLista ? '<div class="note atencion">' + esc(x.avisoLista) + '</div>' : '') + (x.cifrasSinRespaldo && x.cifrasSinRespaldo.length ? '<div class="note atencion">Cifras escritas que no coinciden con las métricas citadas: ' + x.cifrasSinRespaldo.map(c => fmtN(c, 2)).join(', ') + '.</div>' : '') + evChips(x.evidencia) + '</div>').join('');
  if (v.descartados && v.descartados.length) h += '<details><summary>Descartados por la app (' + v.descartados.length + ')</summary><div class="in">' + v.descartados.map(x => '<div class="note atencion"><b>' + esc(x.titulo || '(sin título)') + '</b>: ' + esc(x.motivoDescarte || 'descartado') + '</div>').join('') + '</div></details>';
  if (v.idsInventados) h += '<div class="note atencion">' + v.idsInventados + ' referencia(s) a métricas que no existen se descartaron.</div>';
  if (v.no_verificable.length) h += '<div class="card warn"><div class="t">No se puede afirmar con estos datos</div><div class="d">' + v.no_verificable.map(esc).join('<br>') + '</div></div>';
  if (v.preguntas_al_piloto.length) h += '<div class="card"><div class="t">Preguntas para el piloto</div><div class="d">' + v.preguntas_al_piloto.map(esc).join('<br>') + '</div></div>';
  if (v.avisos.length) h += v.avisos.map(a => '<div class="note atencion">' + esc(a) + '</div>').join('');
  h += '<div class="hint">Huella de integridad ' + esc((ai.sello.ts || '').replace('T', ' ').slice(0, 19)) + ' · ' + esc((ai.sello.hash || '').slice(0, 12)) + ' · detecta cambios accidentales del registro; no impide que alguien con acceso al servidor lo edite.</div>';
  return h;
}
function metaForAI() {
  const P = PS(), m = P.meta, o = {}; ['circuito', 'sesion', 'condicion', 'temp_aire', 'temp_pista', 'neum_del', 'neum_tras', 'neum_vueltas', 'cambio', 'unidad', 'moto'].forEach(k => { if (m[k]) o[k] = m[k]; });
  if (ST.perfil === 'i2m-ducati' && m.moto) { const mo = PF().motos.find(x => x.id === m.moto); if (mo) o.moto = mo.nombre; }
  const s = {}; Object.keys(P.setup).forEach(k => { if (P.setup[k]) s[k] = P.setup[k]; }); if (Object.keys(s).length) o.reglaje = s; return o;
}
async function sealHash(metricas, resultado) { const s = {}; Object.keys(metricas).forEach(k => { if (k.indexOf('S.') === 0) s[k] = metricas[k]; }); return C.sha256hex(JSON.stringify({ s: s, r: resultado })); }
async function askAI() {
  const P = PS(), A = P.A; if (!A) return; if (P.dirty) { toast('Recalcula antes de pedir la lectura.', 'err'); return; }
  const rid = P.runId, hashA = P.hash;
  busy('Consultando al telemetrista IA…', true);
  try {
    let cambios = null, baseInfo = null, baseKey = null; const bc = baseCompare(P);
    if (bc && bc.comp.ok) { cambios = bc.cambios; baseKey = P.base.key; const bf = P.base.rec.ficha; baseInfo = 'sesión del ' + (bf.fecha || '?') + ' en ' + (bf.circuito || '?') + (bf.cambio ? ' (cambio hecho entonces: ' + bf.cambio + ')' : ''); }
    const meta = metaForAI(), payload = C.userPayloadAnalisis(A, meta, ST.perfil, cambios, baseInfo);
    const j = await gas('ai', { system: C.systemPromptAnalisis(ST.perfil), messages: [{ role: 'user', content: payload }] });
    const text = (j && j.content ? j.content.map(x => x.text || '').join('') : '');
    let parsed; try { parsed = C.parseJSONLoose(text); } catch (e) { throw new Error('La IA no devolvió un JSON legible. Vuelve a intentarlo.'); }
    const extra = []; const push = x => { if (isN(x)) extra.push(x); };
    [A.hz, A.dur, A.n, num(P.meta.travelF), num(P.meta.travelR), numRpm(P.meta.rpmLimite)].forEach(push); C.numerosDelTexto(JSON.stringify(meta)).forEach(push); C.numerosDelTexto(baseInfo || '').forEach(push);
    (cambios || []).forEach(c => [c.actual, c.base, c.diff, c.rel].forEach(push));
    const v = C.validateAnalysis(parsed, A.metricas, ST.perfil, { hayBase: !!baseKey, extraNums: extra });
    if (P.runId !== rid || P.A !== A || P.hash !== hashA) { toast('Los datos cambiaron mientras la IA respondía: vuelve a pedir la lectura.', 'err'); return; }
    const hash = await sealHash(A.metricas, v);
    P.ai = { resultado: v, sello: { ts: new Date().toISOString(), hash: hash }, base: baseKey, demo: ST.demo, runId: P.runId };
    renderAnalysis();
  } catch (e) { toast(e.message, 'err'); } finally { busy(''); }
}
let charts = {};
function destroyCharts() { Object.keys(charts).forEach(k => { try { charts[k].destroy(); } catch (e) { } }); charts = {}; }
function drawCharts() {
  const P = PS(), A = P.A; if (!A) return;
  if (typeof Chart === 'undefined') { const c = $('cLap'); if (c) c.parentNode.innerHTML = '<div class="hint">Los gráficos necesitan la librería Chart.js (no cargó).</div>'; return; }
  destroyCharts();
  const S = A.S, COL = ['#8B5CF6', '#27D3B6', '#FFB23D', '#FF7AA8', '#5B8DEF', '#FF5A1F'];
  const ch = P.chartCh, arr = S[ch]; if (arr && $('cLap')) {
    const ds = P.chartLaps.map((n, i) => { const l = A.vueltas.find(x => x.num === n); if (!l || l.sinVueltas) return null; const step = Math.max(1, Math.floor((l.i1 - l.i0) / 1200)), pts = []; for (let k = l.i0; k < l.i1; k += step) pts.push({ x: S.t[k] - S.t[l.i0], y: arr[k] }); return { label: 'V' + n + ' · ' + fmtLap(l.tiempo), data: pts, borderColor: COL[i % COL.length], backgroundColor: COL[i % COL.length], pointRadius: 0, borderWidth: 1.4 }; }).filter(Boolean);
    charts.lap = new Chart($('cLap'), { type: 'line', data: { datasets: ds }, options: { responsive: true, maintainAspectRatio: false, parsing: false, animation: false, scales: { x: { type: 'linear', title: { display: true, text: 'segundos desde el inicio de la vuelta' }, ticks: { color: '#AEB7C7' }, grid: { color: '#283142' } }, y: { title: { display: true, text: C.CANALES[ch].label + ' (' + C.CANALES[ch].unit + ')' }, ticks: { color: '#AEB7C7' }, grid: { color: '#283142' } } }, plugins: { legend: { labels: { color: '#E8ECF3' } } } } });
  }
  if ($('cHist')) {
    const labels = Array.from({ length: 10 }, (_, i) => (i * 10) + '–' + (i * 10 + 10) + ' %'), ds = [];
    if (A.hist.susp_f) ds.push({ label: 'Horquilla', data: A.hist.susp_f, backgroundColor: '#5B8DEF' }); if (A.hist.susp_r) ds.push({ label: 'Amortiguador', data: A.hist.susp_r, backgroundColor: '#FFB23D' });
    charts.hist = new Chart($('cHist'), { type: 'bar', data: { labels: labels, datasets: ds }, options: { responsive: true, maintainAspectRatio: false, animation: false, scales: { x: { ticks: { color: '#AEB7C7' } }, y: { title: { display: true, text: '% del tiempo' }, ticks: { color: '#AEB7C7' }, grid: { color: '#283142' } } }, plugins: { legend: { labels: { color: '#E8ECF3' } } } } });
  }
}

/* ===================== guardar y historial ===================== */
const MAX_CELDA = 46000;
function newRecId() { return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 6); }
function buildRecord(id) {
  const P = PS(), A = P.A, M = A.metricas, sn = P.snap; /* el registro sale de la instantánea del cálculo, no del estado vivo de la pantalla */
  const mapeo = {}, conv = {}; Object.keys(sn.mapping).forEach(k => { const m = sn.mapping[k]; mapeo[k] = m.name || P.table.names[m.col]; conv[k] = { f: m.factor, o: m.offset, inv: !!m.invert, modo: m.mode || '' }; });
  const iaOk = P.ai && P.ai.runId === P.runId;
  const rec = { v: 2, perfil: ST.perfil, id: id, creado: new Date().toISOString(), core: C.VERSION, ficha: Object.assign({}, P.meta), setup: Object.assign({}, P.setup), mapeo: mapeo, conversiones: conv, canales: A.canales.slice(),
    resumen: { archivo: sn.archivo, bytes: sn.bytes, sha256: sn.sha256, n: A.n, hz: Math.round(A.hz * 10) / 10, dur: Math.round(A.dur), metodoVueltas: A.metodoVueltas, recorridoF: sn.calc.travelF, recorridoR: sn.calc.travelR, rpmLimite: sn.calc.rpmLimite },
    vueltas: A.tabla.map(r => ({ num: r.num, tiempo: Math.round(r.tiempo * 1000) / 1000, valida: r.valida, motivo: r.motivo, sinVueltas: !!r.sinVueltas, parcial: !!r.parcial })), metricas: Object.assign({}, M), calidad: A.calidad.slice(0, 14), noVerificable: A.noVerificable.map(x => ({ grupo: x.grupo, falta: x.falta })),
    reglas: P.reglas.map(r => ({ id: r.id, titulo: r.titulo, texto: r.texto, umbral: r.umbral, evidencia: r.evidencia })), ia: iaOk ? { resultado: P.ai.resultado, sello: P.ai.sello, base: P.ai.base, demo: !!P.ai.demo } : null, base: P.base ? P.base.key : null, original: null };
  return rec;
}
function fitRecord(rec, reserva) {
  let s = JSON.stringify(rec);
  if (s.length > MAX_CELDA - reserva) { Object.keys(rec.metricas).forEach(k => { if (/^L\d+\./.test(k) && !/\.tiempo$/.test(k)) delete rec.metricas[k]; }); s = JSON.stringify(rec); }
  if (s.length > MAX_CELDA - reserva) throw new Error('El resumen es demasiado grande (' + s.length + ' caracteres) para una celda del servidor.');
  return s;
}
async function saveSession() {
  if (ST.saving) return; const P = PS(), A = P.A; if (!A || !P.snap) return;
  if (P.dirty) { toast('Recalcula antes de guardar: lo que ves no corresponde a los datos cambiados.', 'err'); return; }
  const miss = []; if (!P.meta.fecha) miss.push('fecha'); if (!P.meta.circuito) miss.push('circuito'); if (ST.perfil === '2d-moto4' ? !P.meta.unidad : !P.meta.moto) miss.push(ST.perfil === '2d-moto4' ? 'número de moto' : 'moto');
  if (miss.length) { toast('Antes de guardar completa en la pestaña 1: ' + miss.join(', ') + '.', 'err'); return; }
  const subir = !!($('saveOrig') && $('saveOrig').checked); P.saveOrig = subir;
  ST.saving = true; busy('Guardando…'); const msg = $('saveMsg'); if (msg) msg.textContent = '';
  try {
    const id = P.recId || P.pendId || (P.pendId = newRecId()), key = 's2:' + ST.perfil + ':' + id; /* el id se reserva antes de escribir: si falla, reintentar sobrescribe el mismo registro */ const rec = buildRecord(id);
    if (P.recId) { const prev = (ST.hist[ST.perfil] || []).find(x => x.key === key); if (prev) rec.creado = prev.rec.creado || rec.creado; }
    let s = fitRecord(rec, subir ? 400 : 0); /* el tamaño se comprueba ANTES de subir nada a Drive */
    let origMsg = '';
    if (subir && !ST.demo) { busy('Subiendo el original a Drive…', true); try { const j = await gas('csv_save', { name: ST.perfil + '_' + id + '_' + P.fileName, content: P.text }); rec.original = { fileId: j.fileId, url: j.url, bytes: j.bytes }; } catch (e) { if (e.code === 'CANCEL') throw new Error('Cancelaste mientras se subía el original: no se guardó nada.'); rec.original = { error: 'No se pudo guardar el original: ' + e.message }; origMsg = ' El original NO se subió a Drive (' + e.message + ').'; } busy('Guardando…'); s = fitRecord(rec, 0); }
    await kvSetVerified(key, s); P.recId = id; P.pendId = null; P.saved = key + ' (' + (s.length / 1000).toFixed(1) + ' mil caracteres)'; P.lastCambioSaved = P.meta.cambio || ''; P.heredada = {}; SES_KEYS.forEach(k => { P.heredada[k] = P.meta[k] || ''; }); P.tocados = new Set();
    if (ST.histLoaded[ST.perfil]) { const lst = ST.hist[ST.perfil] || (ST.hist[ST.perfil] = []); const i = lst.findIndex(x => x.key === key); const item = { key: key, rec: normRecord(JSON.parse(s)), sealOk: rec.ia ? true : null }; if (i >= 0) lst[i] = item; else lst.unshift(item); sortHist(); }
    toast('Sesión guardada y verificada ✓' + origMsg, origMsg ? 'err' : 'ok');
  } catch (e) { toast('NO se guardó: ' + e.message, 'err'); }
  finally { ST.saving = false; busy(''); if (ST.tab === 'analisis') renderAnalysis(); }
}
const S1 = (x, n) => String(x == null ? '' : x).slice(0, n || 1200), AR = x => Array.isArray(x) ? x : [], OB = x => (x && typeof x === 'object' && !Array.isArray(x)) ? x : {};
function strMap(o, max) { const out = {}; Object.keys(OB(o)).slice(0, max || 80).forEach(k => { const v = o[k]; if (typeof v === 'string' || typeof v === 'number') out[k] = S1(v, 600); }); return out; }
function normEv(a) { return AR(a).slice(0, 12).filter(e => e && typeof e.id === 'string' && isFinite(+e.valor)).map(e => ({ id: S1(e.id, 80), valor: +e.valor, corregido: !!e.corregido })); }
function normAI(ia) {
  if (!ia || typeof ia !== 'object' || !ia.resultado || typeof ia.resultado !== 'object') return null;
  const r = ia.resultado, nums = a => AR(a).filter(isN).slice(0, 10);
  const h = x => { x = OB(x); return { titulo: S1(x.titulo, 200), categoria: okCat(x.categoria), confianza: safeConf(x.confianza), confianzaLimitada: !!x.confianzaLimitada, interpretacion: S1(x.interpretacion, 900), accion: S1(x.accion, 500), avisoReglamento: S1(x.avisoReglamento, 500), avisoPilotaje: S1(x.avisoPilotaje, 500), avisoLista: S1(x.avisoLista, 500), cifrasSinRespaldo: nums(x.cifrasSinRespaldo), evidencia: normEv(x.evidencia), motivoDescarte: S1(x.motivoDescarte, 300) }; };
  const pr = r.prioridad && typeof r.prioridad === 'object' ? { accion: S1(r.prioridad.accion, 500), por_que: S1(r.prioridad.por_que, 600), evidencia: normEv(r.prioridad.evidencia), sinRespaldo: !!r.prioridad.sinRespaldo, avisoReglamento: S1(r.prioridad.avisoReglamento, 500), avisoPilotaje: S1(r.prioridad.avisoPilotaje, 500), avisoLista: S1(r.prioridad.avisoLista, 500), cifrasSinRespaldo: nums(r.prioridad.cifrasSinRespaldo) } : null;
  return { resultado: { resumen: S1(r.resumen, 600), prioridad: pr, hallazgos: AR(r.hallazgos).slice(0, 8).map(h), descartados: AR(r.descartados).slice(0, 8).map(h), no_verificable: AR(r.no_verificable).slice(0, 12).map(x => S1(x, 300)), preguntas_al_piloto: AR(r.preguntas_al_piloto).slice(0, 8).map(x => S1(x, 300)), avisos: AR(r.avisos).slice(0, 12).map(x => S1(x, 300)), idsInventados: +r.idsInventados || 0, resumenCifrasSinRespaldo: nums(r.resumenCifrasSinRespaldo) }, sello: { ts: S1(OB(ia.sello).ts, 40), hash: S1(OB(ia.sello).hash, 80) }, base: ia.base ? S1(ia.base, 120) : null, demo: !!ia.demo };
}
/* devuelve un registro saneado, o null si no se puede usar; nunca lanza */
function normRecord(r) {
  try {
    if (!r || typeof r !== 'object' || !r.perfil || !r.ficha || typeof r.ficha !== 'object' || !r.metricas || typeof r.metricas !== 'object') return null;
    const met = {}; Object.keys(r.metricas).forEach(k => { if (isN(r.metricas[k])) met[k] = r.metricas[k]; });
    const rs = OB(r.resumen), n = x => isN(+x) && x !== null && x !== '' ? +x : null;
    return { v: r.v || 1, perfil: S1(r.perfil, 30), id: S1(r.id, 60), creado: S1(r.creado, 40), core: S1(r.core, 40), ficha: strMap(r.ficha), setup: strMap(r.setup), mapeo: strMap(r.mapeo), canales: AR(r.canales).map(x => S1(x, 30)).slice(0, 60),
      resumen: { archivo: S1(rs.archivo, 200), bytes: n(rs.bytes), sha256: S1(rs.sha256, 80), n: n(rs.n), hz: n(rs.hz), dur: n(rs.dur), metodoVueltas: S1(rs.metodoVueltas, 80), recorridoF: n(rs.recorridoF), recorridoR: n(rs.recorridoR), rpmLimite: n(rs.rpmLimite) },
      vueltas: AR(r.vueltas).filter(l => l && isN(+l.num)).map(l => ({ num: +l.num, tiempo: n(l.tiempo), valida: !!l.valida, motivo: S1(l.motivo, 120), sinVueltas: !!l.sinVueltas, parcial: !!l.parcial })),
      metricas: met, calidad: AR(r.calidad).slice(0, 14).map(c => ({ nivel: ['info', 'atencion', 'alerta'].indexOf(OB(c).nivel) >= 0 ? c.nivel : 'info', texto: S1(OB(c).texto, 600) })), noVerificable: AR(r.noVerificable).slice(0, 40).map(x => ({ grupo: S1(OB(x).grupo, 80), falta: S1(OB(x).falta, 200) })),
      reglas: AR(r.reglas).slice(0, 20).map(x => ({ id: S1(OB(x).id, 30), titulo: S1(OB(x).titulo, 200), texto: S1(OB(x).texto, 600), umbral: S1(OB(x).umbral, 200), evidencia: AR(OB(x).evidencia).map(e => S1(e, 80)) })), ia: normAI(r.ia), base: r.base ? S1(r.base, 120) : null,
      original: r.original && typeof r.original === 'object' ? { fileId: S1(r.original.fileId, 120), url: S1(r.original.url, 400), bytes: n(r.original.bytes), error: S1(r.original.error, 300) } : null };
  } catch (e) { return null; }
}
function sortHist() { const l = ST.hist[ST.perfil]; if (l) l.sort((a, b) => (b.rec.ficha.fecha || '').localeCompare(a.rec.ficha.fecha || '') || (b.rec.creado || '').localeCompare(a.rec.creado || '')); }
async function loadHistory(force) {
  if (ST.histLoaded[ST.perfil] && !force) return; busy('Cargando sesiones…'); const perfil = ST.perfil;
  try {
    const items = await kvDump('s2:' + perfil + ':'); const out = []; let malos = 0;
    for (const it of items) {
      try {
        const raw = parseVal(it[1]); const rec = raw && raw.perfil === perfil ? normRecord(raw) : null; if (!rec) { malos++; continue; }
        let sealOk = null; if (raw.ia && raw.ia.sello && raw.ia.resultado && raw.ia.sello.hash) { try { sealOk = (await sealHash(raw.metricas, raw.ia.resultado)) === raw.ia.sello.hash; } catch (e) { sealOk = null; } }
        out.push({ key: it[0], rec: rec, sealOk: sealOk });
      } catch (e) { malos++; }
    }
    ST.hist[perfil] = out; ST.histBad[perfil] = malos; ST.histLoaded[perfil] = true; sortHist();
  } catch (e) { toast('No se pudo cargar el historial: ' + e.message, 'err'); } finally { busy(''); }
}
function bestLapOf(rec) { const v = rec.vueltas.filter(l => l.valida && !l.sinVueltas && !l.parcial && isN(l.tiempo) && l.tiempo > 0); return v.length ? Math.min.apply(null, v.map(l => l.tiempo)) : null; }
function motoLabel(f) { return f.unidad ? '#' + f.unidad : (PF().motos ? (PF().motos.find(m => m.id === f.moto) || { nombre: '—' }).nombre : '—'); }
function renderHistory() {
  const el = $('hisBody'), hs = ST.hist[ST.perfil] || [];
  if (!ST.histLoaded[ST.perfil]) { el.innerHTML = '<div class="panel"><h2>Historial de ' + esc(PF().etiqueta) + '</h2><p class="sub">Aquí solo aparecen sesiones de este sistema: 2D y I2M nunca se mezclan.</p><button class="btn pri" data-act="loadHist">Cargar mis sesiones</button></div>'; return; }
  const malos = ST.histBad[ST.perfil] || 0, avisoMalos = malos ? '<div class="banner warn">' + malos + ' registro(s) del servidor no se pudieron leer y se omitieron.</div>' : '';
  if (!hs.length) { el.innerHTML = avisoMalos + '<div class="banner">Todavía no hay sesiones guardadas de ' + esc(PF().etiqueta) + '.</div><button class="btn sm" data-act="reloadHist">Actualizar</button>'; return; }
  const asc = hs.slice().sort((a, b) => (a.rec.ficha.fecha || '').localeCompare(b.rec.ficha.fecha || '') || (a.rec.creado || '').localeCompare(b.rec.creado || ''));
  let h = avisoMalos + '<div class="panel"><h2>Bitácora de cambios y resultados</h2><p class="sub">Cada fila: qué se cambió y cómo varió la mejor vuelta respecto a la sesión anterior del mismo circuito y la misma moto. Es una pista, no una prueba: influyen pista, neumáticos y piloto. Las sesiones sin vueltas detectadas no entran.</p><div class="tw"><table><thead><tr><th>Fecha</th><th>Circuito</th><th>Moto</th><th>Cambio hecho</th><th class="num">Mejor vuelta</th><th class="num">Dif. vs. anterior</th></tr></thead><tbody>';
  asc.forEach((x, i) => {
    const r = x.rec, bl = bestLapOf(r); const prev = asc.slice(0, i).reverse().find(y => y.rec.ficha.circuito && C.sameCircuit(y.rec.ficha.circuito, r.ficha.circuito) && C._u.norm(y.rec.ficha.unidad || y.rec.ficha.moto || '') === C._u.norm(r.ficha.unidad || r.ficha.moto || '') && bestLapOf(y.rec) != null); const pl = prev ? bestLapOf(prev.rec) : null; const d = (bl != null && pl != null) ? bl - pl : null;
    h += '<tr><td>' + esc(r.ficha.fecha || (r.creado || '').slice(0, 10)) + '</td><td>' + esc(r.ficha.circuito || '—') + '</td><td>' + esc(motoLabel(r.ficha)) + '</td><td>' + esc(r.ficha.cambio || '—') + '</td><td class="num">' + (bl != null ? fmtLap(bl) : '—') + '</td><td class="num">' + (d != null ? (d > 0 ? '+' : '') + d.toFixed(3) + ' s' : '—') + '</td></tr>';
  });
  h += '</tbody></table></div></div><div class="panel"><h2>Sesiones guardadas (' + hs.length + ')</h2><button class="btn sm" data-act="reloadHist">Actualizar</button><div class="tw" style="margin-top:10px"><table><thead><tr><th>Fecha</th><th>Circuito</th><th>Sesión</th><th class="num">Vueltas</th><th class="num">Mejor</th><th>IA</th><th></th></tr></thead><tbody>' +
    hs.map(x => { const r = x.rec; return '<tr><td>' + esc(r.ficha.fecha || '') + '</td><td>' + esc(r.ficha.circuito || '') + '</td><td>' + esc(r.ficha.sesion || '') + '</td><td class="num">' + r.vueltas.filter(l => l.valida && !l.sinVueltas).length + '</td><td class="num">' + (bestLapOf(r) != null ? fmtLap(bestLapOf(r)) : '—') + '</td><td>' + (r.ia ? '<span class="chip ok">sí</span>' : '') + '</td><td><button class="btn sm" data-act="viewSes" data-v="' + esc(x.key) + '">Ver</button> <button class="btn sm" data-act="useBase" data-v="' + esc(x.key) + '">Usar como base</button></td></tr>'; }).join('') + '</tbody></table></div></div><div id="sesView"></div>';
  el.innerHTML = h;
}
function viewSession(key) {
  const x = (ST.hist[ST.perfil] || []).find(y => y.key === key); if (!x) return; const r = x.rec; const S = Object.keys(r.metricas).filter(k => k.indexOf('S.') === 0 && !/_hist\d+$/.test(k));
  $('sesView').innerHTML = '<div class="panel"><h2>' + esc((r.ficha.fecha || '') + ' · ' + (r.ficha.circuito || '')) + '</h2><div class="chips">' + [r.ficha.sesion, r.ficha.piloto, r.ficha.condicion, r.resumen.archivo, r.resumen.hz ? fmtN(r.resumen.hz, 1) + ' Hz' : ''].filter(Boolean).map(t => '<span class="chip">' + esc(t) + '</span>').join('') + '</div>' + (r.ficha.cambio ? '<div class="note info"><b>Cambio:</b> ' + esc(r.ficha.cambio) + '</div>' : '') + (r.ficha.notas ? '<div class="note">' + esc(r.ficha.notas) + '</div>' : '') +
    (r.ia && x.sealOk === false ? '<div class="banner bad"><b>La huella de la lectura de la IA NO coincide:</b> las métricas o la lectura de la IA cambiaron después de guardarse (o se editó a mano en el servidor). No te fíes de su contenido.</div>' : '') +
    (r.ia ? '<h3 class="gh" style="margin:14px 0 6px">Lectura de la IA</h3>' + aiHTML(r.ia, false) : '') + '<details><summary>Cifras de la sesión (' + S.length + ')</summary><div class="in"><table><tbody>' + S.map(k => metricRow(k, r.metricas[k])).join('') + '</tbody></table></div></details></div>';
  $('sesView').scrollIntoView({ behavior: 'smooth' });
}

/* ===================== cuaderno privado ===================== */
const nbDirty = () => !!(ST.nb && ST.nb.dirty);
function userSlug() { const u = String(ST.user || '').normalize('NFKC').toLowerCase().trim(); let h = 5381; for (const ch of u) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0; return (u.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'u') + '-' + h.toString(36); }
const nbP = () => 'cuad2:u:' + userSlug() + ':';
const NB_META = () => nbP() + '_meta', NB_IDX = () => nbP() + 'idx', NB_E = () => nbP() + 'e:';
const aadE = (k, rev) => 'cuaderno|' + k + '|' + (rev || 0), aadI = rev => 'cuaderno|idx|' + (rev || 0);
function descarga(texto, nombre) { const b = new Blob([texto], { type: 'application/json' }), u = URL.createObjectURL(b), a = document.createElement('a'); a.href = u; a.download = nombre; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); }
async function nbStatus() {
  const V = ST.vault; if (V.state !== 'desconocido') return;
  try {
    const raw = await kvGet(NB_META()); const m = parseVal(raw);
    if (raw != null && !(m && m.salt && m.canary)) { V.state = 'error'; V.err = 'La configuración del cuaderno existe pero está dañada. No se crea otra encima para no perder tus entradas: revisa la hoja del servidor o pide ayuda con la copia de seguridad.'; return; }
    if (m) { V.meta = m; V.state = 'bloqueado'; return; }
    const ks = await kvList(NB_E()); V.huerfanas = ks.length; V.state = ks.length ? 'sin_meta' : 'sin_crear';
  } catch (e) { V.state = 'error'; V.err = e.message; }
}
function nbEnsureEditor() { if (!ST.nb) ST.nb = { id: null, rev: 0, creado: '', perfil: ST.perfil, sesKey: '', idioma: '', piloto: '', consent: false, texto: '', frases: [], cruce: null, cambios: [{ cambio: '', resultado: '' }], notas: '', sello: null, sealOk: null, dirty: false }; return ST.nb; }
const nbGateOk = E => !!E.consent && E.frases.length > 0 && E.frases.every(f => (f.criterio || '').trim() || f.sinCriterio);
function nbGate() { const b = $('nbCrossBtn'); if (b) b.disabled = !nbGateOk(nbEnsureEditor()); }
const ACIERTOS = [['', 'Todavía no he probado'], ['antonio', 'Acertó mi criterio'], ['ia', 'Acertó la IA'], ['ambos', 'Acertamos los dos'], ['ninguno', 'Ninguno acertó']];
const ACIERTO_TXT = { antonio: 'tu criterio', ia: 'la IA', ambos: 'los dos', ninguno: 'ninguno' };
// marcador: de las frases ya probadas, cuántas acertó tu criterio y cuántas la IA (la IA solo cuenta donde tomó postura: corroborada o contradicha)
function nbMarcador(entries) {
  let n = 0, an = 0, m = 0, iaOk = 0;
  (entries || []).forEach(e => (e.frases || []).forEach(f => { if (!ACIERTO_TXT[f.acierto]) return; n++; if (f.acierto === 'antonio' || f.acierto === 'ambos') an++; if (f.estado === 'corroborada' || f.estado === 'contradicha') { m++; if (f.acierto === 'ia' || f.acierto === 'ambos') iaOk++; } }));
  return { n: n, an: an, m: m, iaOk: iaOk };
}
const INTRO_NB = () => '<div class="banner"><b>Cuaderno privado de «' + esc(ST.user || '') + '».</b> Lo que escribes aquí se cifra en tu navegador con una frase que solo tú sabes. En el servidor del equipo queda únicamente texto cifrado, y sin la frase nadie puede leerlo ni recuperarlo. <b>Límites:</b> (1) mientras escribes, el navegador de este aparato lo ve todo; (2) al pulsar «Cruzar con los datos», las frases del piloto salen EN CLARO hacia el servidor del equipo y de ahí al proveedor de IA; (3) la separación por usuario es por nombre, no un permiso del servidor: quien tenga acceso técnico a la hoja podría borrar o estropear entradas (la app lo detecta, no lo impide). Usa un apodo o código para el piloto, no su nombre. Para dictar con el iPhone, usa el micrófono del teclado.</div>';
async function renderNotebook() {
  const el = $('nbBody'); const V = ST.vault; if (V.state === 'desconocido') el.innerHTML = '<div class="hint">Cargando…</div>'; await nbStatus(); const intro = INTRO_NB();
  if (V.state === 'error') { el.innerHTML = intro + '<div class="banner bad">No se pudo consultar el servidor: ' + esc(V.err) + '</div><button class="btn sm" data-act="nbRetry">Reintentar</button>'; return; }
  if (V.state === 'sin_crear') { el.innerHTML = intro + '<div class="panel"><h2>Crear el cuaderno</h2><p class="sub">Elige una frase de 12 caracteres o más (mejor 4 palabras). No se guarda en ningún sitio: si la pierdes, el cuaderno no se puede recuperar.</p><div class="grid"><label class="f">Frase secreta<input type="password" id="nbP1" autocomplete="new-password"></label><label class="f">Repite la frase<input type="password" id="nbP2" autocomplete="new-password"></label></div><label class="chip" style="margin-top:10px"><input type="checkbox" id="nbOk"> Entiendo que si pierdo la frase nadie puede recuperar el cuaderno</label><div class="row" style="margin-top:12px"><button class="btn pri" data-act="nbCreate">Crear cuaderno</button></div></div>'; return; }
  if (V.state === 'sin_meta') { el.innerHTML = intro + '<div class="banner bad">Hay ' + V.huerfanas + ' entrada(s) cifrada(s) pero falta la configuración del cuaderno (se borró o se estropeó en el servidor). Si escribes la frase correcta se puede reconstruir a partir de la sal guardada en las entradas.</div><div class="panel"><h2>Reconstruir el cuaderno</h2><label class="f" style="max-width:360px">Frase secreta<input type="password" id="nbP1" autocomplete="current-password"></label><div class="row" style="margin-top:12px"><button class="btn pri" data-act="nbRecover">Reconstruir y abrir</button><button class="btn sm" data-act="nbBackup">Descargar copia de lo que hay</button><span id="nbErr" class="hint" style="color:var(--bad)" role="alert"></span></div></div>'; return; }
  if (V.state === 'bloqueado') { el.innerHTML = intro + '<div class="panel"><h2>Abrir el cuaderno</h2><label class="f" style="max-width:360px">Frase secreta<input type="password" id="nbP1" autocomplete="current-password"></label><div class="row" style="margin-top:12px"><button class="btn pri" data-act="nbUnlock">Abrir</button><span id="nbErr" style="color:var(--bad);font-size:13px" role="alert"></span></div><p class="hint">Si nunca creaste un cuaderno con este usuario y aun así aparece, avisa: alguien más pudo crearlo.</p></div>'; return; }
  /* abierto */
  if (!ST.histLoaded[ST.perfil]) { await loadHistory(); }
  const E = nbEnsureEditor(), ses = ST.hist[ST.perfil] || [], crossed = !!E.cruce; let h = intro;
  if (V.recienCreado) h += '<div class="banner warn"><b>Descarga ahora una copia de seguridad y guárdala fuera de este aparato.</b> Sigue cifrada: solo se abre con tu frase. Esta página todavía no tiene botón para restaurarla; si algún día hace falta, se reconstruye con ayuda de quien mantiene la app. <button class="btn sm pri" data-act="nbBackup">Descargar copia de seguridad</button></div>';
  h += '<div class="row" style="margin-bottom:12px"><button class="btn sm" data-act="nbLock">Bloquear</button><button class="btn sm" data-act="nbNew">Nueva entrada</button><button class="btn sm" data-act="nbBackup">Copia de seguridad</button><button class="btn sm" data-act="loadHist">Cargar sesiones guardadas</button></div>';
  if (V.avisos.length) h += V.avisos.map(a => '<div class="banner warn" role="alert">' + esc(a) + '</div>').join('');
  h += '<div class="panel"><h2>' + (E.id ? 'Entrada abierta' : 'Nueva entrada') + ' · ' + esc(PF().etiqueta) + '</h2><p class="sub">Primero escribe lo que dijo el piloto y <b>tu criterio</b>. La lectura de la IA solo se desbloquea cuando hay un criterio por frase (o marcas que todavía no lo tienes). Para que tu criterio no dependa de la IA, guarda la sesión SIN pedir la lectura IA y escribe el cuaderno antes.</p>';
  h += '<div class="grid w2"><label class="f">Sesión de datos (guardada)<select data-nb="sesKey"' + (crossed ? ' disabled' : '') + ' aria-label="Sesión de datos"><option value="">— elige —</option>' + ses.map(x => '<option value="' + esc(x.key) + '"' + (E.sesKey === x.key ? ' selected' : '') + '>' + esc((x.rec.ficha.fecha || '') + ' · ' + (x.rec.ficha.circuito || '') + (x.rec.ia ? ' · con lectura IA' : ' · sin lectura IA') + (x.rec.ficha.cambio ? ' · ' + x.rec.ficha.cambio.slice(0, 24) : '')) + '</option>').join('') + '</select></label><label class="f">Idioma del piloto<input data-nb="idioma" value="' + esc(E.idioma) + '" placeholder="Ej.: inglés, italiano, español"></label><label class="f">Piloto (apodo o código)<input data-nb="piloto" value="' + esc(E.piloto) + '" placeholder="Ej.: Piloto A"></label></div>';
  if (!ses.length) h += '<div class="note atencion">No hay sesiones guardadas. Analiza un archivo, guarda la sesión y vuelve aquí (o pulsa «Cargar sesiones guardadas»).</div>';
  h += '<label class="f" style="margin-top:12px">Lo que dijo el piloto (una frase por línea, en su idioma)<textarea data-nb="texto" style="min-height:110px"' + (crossed ? ' readonly' : '') + '>' + esc(E.texto) + '</textarea></label><div class="row" style="margin-top:8px"><button class="btn sm" data-act="nbRows"' + (crossed ? ' disabled' : '') + '>Preparar filas</button>' + (crossed ? '<span class="hint">Ya cruzado: el texto y la sesión quedan fijos. Para otra sesión, abre una entrada nueva.</span>' : '') + '</div>';
  h += '<label class="chip" style="margin-top:10px"><input type="checkbox" data-nb="consent"' + (E.consent ? ' checked' : '') + '> Tengo permiso para registrar lo que dice el piloto (si es menor de edad, el de su tutor)</label></div>';
  if (E.frases.length) {
    h += '<div class="panel"><h2>Piloto · Telemetrista IA · Tu criterio</h2>';
    E.frases.forEach((f, i) => {
      const voc = f.vocab ? C.VOCAB.find(v => v.id === f.vocab) : null;
      h += '<div class="three"><div class="col p"><h4>Piloto</h4>' + esc(f.texto) + (crossed && f.es && f.es.trim() !== f.texto.trim() ? '<div class="hint" style="margin-top:6px">ES: ' + esc(f.es) + '</div>' : '') + (voc ? '<div class="hint" style="margin-top:6px">Vocabulario: ' + esc(voc.es[0]) + '</div>' : '') + '</div>' +
        '<div class="col i"><h4>Telemetrista IA</h4>' + (crossed ? '<span class="st ' + esc(f.estado || 'datos_insuficientes') + '">' + esc(String(f.estado || 'datos_insuficientes').replace(/_/g, ' ')) + '</span>' + (f.fuerza === 'indicio' ? ' <span class="badge">compatible con (indicio, no prueba)</span>' : '') + '<div class="d">' + esc(f.comentario) + '</div>' + evChips(f.evidencia) : '<div class="lock">🔒 Se desbloquea cuando escribas tu criterio en cada frase (o marques «todavía no lo tengo») y pulses «Cruzar con los datos».</div>') + '</div>' +
        '<div class="col a"><h4>Tu criterio</h4>' + (crossed ? '<div class="frozen"><b>Antes de ver a la IA (congelado):</b> ' + (f.criterioPre ? esc(f.criterioPre) : '— sin criterio: la viste primero —') + '</div><label class="f">Tu criterio ahora<textarea data-nbf="' + i + '" aria-label="Tu criterio ahora, frase ' + (i + 1) + '">' + esc(f.criterio || '') + '</textarea></label>' : '<textarea data-nbf="' + i + '" aria-label="Tu criterio, frase ' + (i + 1) + '" placeholder="Qué piensas tú, según tu experiencia y lo que sentiste del piloto">' + esc(f.criterio || '') + '</textarea><label class="chip" style="margin-top:6px"><input type="checkbox" data-nbs="' + i + '"' + (f.sinCriterio ? ' checked' : '') + '> Todavía no tengo criterio</label>') + '</div></div>';
      if (crossed) h += '<div class="row acierto"><label class="f" style="max-width:420px">Tras probar el cambio: ¿quién acertó en esta frase?<select data-nbr="' + i + '" aria-label="Quién acertó, frase ' + (i + 1) + '">' + ACIERTOS.map(a => '<option value="' + a[0] + '"' + ((f.acierto || '') === a[0] ? ' selected' : '') + '>' + esc(a[1]) + '</option>').join('') + '</select></label></div>';
    });
    if (!crossed) h += '<div class="row"><button class="btn pri" id="nbCrossBtn" data-act="nbCross"' + (nbGateOk(E) ? '' : ' disabled') + '>Cruzar con los datos</button><span class="hint">' + (E.consent ? 'Se envían a la IA las frases y las cifras de la sesión elegida (no tu criterio).' : 'Marca antes el permiso para registrar lo que dice el piloto: al cruzar, sus frases salen hacia la IA.') + '</span></div>';
    else h += '<div class="hint">Cruzado el ' + esc((E.cruce.ts || '').replace('T', ' ').slice(0, 16)) + (E.sello ? ' · huella de la lectura IA ' + esc(String(E.sello.hash || '').slice(0, 12)) : '') + (E.sealOk === false ? ' · <b style="color:var(--bad)">la huella de esa sesión no coincidía al cruzar</b>' : '') + '. Puedes seguir editando «Tu criterio ahora»; lo anterior queda congelado.</div>';
    if (crossed && E.cruce.sin_mencionar && E.cruce.sin_mencionar.length) h += '<div class="card warn" style="margin-top:12px"><div class="t">Hallazgos de los datos que el piloto no mencionó</div><div class="d">' + E.cruce.sin_mencionar.map(esc).join('<br>') + '</div></div>';
    h += '</div>';
    h += '<div class="panel"><h2>Cambios probados y qué pasó</h2><p class="sub">Para recordar qué se hizo y si funcionó.</p>' + E.cambios.map((c, i) => '<div class="grid w2" style="margin-bottom:8px"><label class="f">Cambio<input data-nbc="' + i + ':cambio" value="' + esc(c.cambio) + '"></label><label class="f">Resultado<input data-nbc="' + i + ':resultado" value="' + esc(c.resultado) + '"></label></div>').join('') + '<div class="row"><button class="btn sm" data-act="nbAddChange">+ otro cambio</button></div><label class="f" style="margin-top:12px">Notas libres<textarea data-nb="notas">' + esc(E.notas) + '</textarea></label><div class="row" style="margin-top:12px"><button class="btn pri" data-act="nbSave">Guardar entrada cifrada</button><span id="nbMsg" class="hint" role="status"></span></div></div>';
  }
  const mine = V.listaError ? null : (V.entries || []).filter(e => (e.perfil || ST.perfil) === ST.perfil);
  const mk = nbMarcador(mine);
  h += '<div class="panel"><h2>Entradas guardadas</h2>' + (mk.n ? '<div class="note info" role="status"><b>Marcador (' + mk.n + ' frase(s) ya probadas):</b> tu criterio acertó en ' + mk.an + ' de ' + mk.n + (mk.m ? '; la IA acertó en ' + mk.iaOk + ' de las ' + mk.m + ' en que tomó postura (corroborada o contradicha). ' : '; la IA no tomó postura en ninguna (todo quedó en «datos insuficientes»). ') + 'Con pocas frases esto es una impresión, no una estadística.</div>' : '') + (V.listaError ? '<div class="banner bad">No se pudieron leer las entradas: ' + esc(V.listaError) + ' <button class="btn sm" data-act="nbRefresh">Reintentar</button></div>' : mine.length ? '<div class="tw"><table><thead><tr><th>Fecha</th><th>Sesión</th><th>Piloto</th><th class="num">Frases</th><th>Resultado del cruce</th><th>Tras probar</th><th></th></tr></thead><tbody>' + mine.map(e => { const cnt = {}; (e.frases || []).forEach(f => { const k = f.estado || 'sin cruzar'; cnt[k] = (cnt[k] || 0) + 1; }); return '<tr><td>' + esc((e.ts || '').slice(0, 16).replace('T', ' ')) + '</td><td>' + esc(e.sesionResumen || '') + '</td><td>' + esc(e.piloto || '') + '</td><td class="num">' + (e.frases || []).length + '</td><td>' + Object.keys(cnt).map(k => esc(k.replace(/_/g, ' ')) + ' ' + cnt[k]).join(' · ') + '</td><td>' + (() => { const ac = {}; (e.frases || []).forEach(f => { if (ACIERTO_TXT[f.acierto]) ac[f.acierto] = (ac[f.acierto] || 0) + 1; }); const ks = Object.keys(ac); return ks.length ? ks.map(k => esc(ACIERTO_TXT[k]) + ' ' + ac[k]).join(' · ') : '—'; })() + '</td><td><button class="btn sm" data-act="nbOpen" data-v="' + esc(e.id) + '">Abrir</button></td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="hint">Todavía no hay entradas de este sistema.</div>') + '<div class="row" style="margin-top:10px"><button class="btn sm" data-act="nbRefresh">Actualizar lista</button></div></div>';
  el.innerHTML = h;
}
async function nbCreate() {
  const p1 = $('nbP1').value, p2 = $('nbP2').value; const mal = C.passCheck(p1);
  if (mal) { toast(mal, 'err'); return; } if (p1 !== p2) { toast('Las dos frases no coinciden.', 'err'); return; } if (!$('nbOk').checked) { toast('Marca la casilla: sin la frase no hay recuperación.', 'err'); return; }
  busy('Creando… (tarda unos 8 segundos: se comprueba dos veces)'); const V = ST.vault;
  try {
    if (await kvGet(NB_META()) != null) { V.state = 'desconocido'; throw new Error('Ya existe un cuaderno creado. Ábrelo con tu frase.'); }
    const v = await C.vaultCreate(p1); await kvSetVerified(NB_META(), JSON.stringify(v.meta));
    await sleep(1500); let otra = parseVal(await kvGet(NB_META()));
    if (otra && otra.salt === v.meta.salt) { await sleep(4500); otra = parseVal(await kvGet(NB_META())); } /* segunda lectura: el servidor puede tardar varios segundos en una escritura que llega tarde */
    if (!otra || otra.salt !== v.meta.salt) { V.state = 'desconocido'; throw new Error('Otro dispositivo creó un cuaderno al mismo tiempo y el suyo prevaleció. Abre el cuaderno con la frase de ese dispositivo; este no se creó.'); }
    V.key = v.key; V.meta = v.meta; V.state = 'abierto'; V.entries = []; V.avisos = []; V.listaError = ''; V.recienCreado = true; toast('Cuaderno creado y verificado ✓', 'ok');
  } catch (e) { toast(e.message, 'err'); } finally { busy(''); } renderNotebook();
}
async function nbUnlock() {
  const p = $('nbP1').value; busy('Abriendo… (puede tardar un par de segundos)'); await nextFrame();
  try { ST.vault.key = await C.vaultUnlock(p, ST.vault.meta); ST.vault.state = 'abierto'; ST.vault.recienCreado = false; await nbRefresh(true); }
  catch (e) { ST.vault.key = null; ST.vault.state = 'bloqueado'; busy(''); const er = $('nbErr'); if (er) er.textContent = e.message; return; } finally { busy(''); } renderNotebook();
}
async function nbRecover() {
  const p = $('nbP1').value; busy('Reconstruyendo… (puede tardar un par de segundos)'); await nextFrame(); const V = ST.vault;
  try {
    if (await kvGet(NB_META()) != null) { V.state = 'desconocido'; throw new Error('La configuración ya existe: ábrela con tu frase.'); }
    const items = await kvDump(NB_E()); let ok = null;
    for (const it of items) { const b = parseVal(it[1]); if (b && b.salt && b.ct) { try { const r = await C.vaultRebuild(p, b.salt, b.iter); await C.decryptJSON(r.key, b, aadE(it[0], b.rev)); ok = r; break; } catch (e) { /* frase distinta o entrada dañada: se prueba la siguiente */ } } }
    if (!ok) throw new Error('Frase incorrecta o ninguna entrada trae la sal necesaria.');
    await kvSetVerified(NB_META(), JSON.stringify(ok.meta)); V.key = ok.key; V.meta = ok.meta; V.state = 'abierto'; V.recienCreado = true; await nbRefresh(true); toast('Cuaderno reconstruido ✓. Descarga la copia de seguridad.', 'ok');
  } catch (e) { busy(''); const er = $('nbErr'); if (er) er.textContent = e.message; else toast(e.message, 'err'); return; } finally { busy(''); } renderNotebook();
}
async function nbRefresh(silent) {
  const V = ST.vault; V.avisos = []; V.listaError = ''; let items;
  try { items = await kvDump(NB_E()); } catch (e) { V.listaError = e.message; V.entries = []; if (!silent) renderNotebook(); return; }
  const out = [], malas = []; let otraSal = 0;
  for (const it of items) {
    try { const blob = parseVal(it[1]); if (!blob || !blob.ct) throw 0; if (blob.salt && V.meta && blob.salt !== V.meta.salt) { otraSal++; throw 0; } const e = await C.decryptJSON(V.key, blob, aadE(it[0], blob.rev)); if (!e || !e.id || NB_E() + e.id !== it[0]) throw 0; e.__key = it[0]; e.__rev = +blob.rev || 0; out.push(e); } catch (er) { malas.push(it[0]); }
  }
  let idx = null;
  try { const rawI = await kvGet(NB_IDX()); if (rawI != null) { const b = parseVal(rawI); idx = await C.decryptJSON(V.key, b, aadI(b.rev)); } else if (out.length || malas.length) V.avisos.push('Falta el índice del cuaderno: no se puede comprobar si falta alguna entrada. Alguien pudo borrarlo, o se perdió en el servidor.'); } catch (e) { V.avisos.push('El índice del cuaderno no se pudo abrir (dañado o de otra frase). Las entradas se muestran igual, pero no se puede comprobar si falta alguna.'); }
  if (idx && idx.entries) Object.keys(idx.entries).forEach(id => { const w = idx.entries[id], e = out.find(x => x.id === id); if (!e) V.avisos.push('Falta la entrada «' + (w.t || id) + '», que el índice registra: se borró o se perdió en el servidor.'); else if (e.__rev < w.rev) V.avisos.push('La entrada «' + (w.t || id) + '» está en una versión anterior (' + e.__rev + ' en vez de ' + w.rev + '): alguien pudo restaurar una copia vieja.'); });
  if (otraSal) V.avisos.push(otraSal + ' entrada(s) se cifraron con otra configuración del cuaderno (lo normal si dos aparatos lo crearon a la vez). Siguen en el servidor pero no se pueden abrir desde aquí: no las borres y pide ayuda para repararlas.');
  if (malas.length - otraSal > 0) V.avisos.push((malas.length - otraSal) + ' entrada(s) no se pudieron abrir (frase distinta o registros dañados).');
  V.idx = idx; V.entries = out.sort((a, b) => (b.ts || '').localeCompare(a.ts || '')); if (!silent) renderNotebook();
}
function nbLock() {
  if (nbDirty() && !confirm('Tienes una entrada sin guardar. Si bloqueas se pierde. ¿Bloquear?')) return;
  const V = ST.vault; V.key = null; V.state = 'bloqueado'; V.entries = []; V.avisos = []; V.recienCreado = false; ST.nb = null; renderNotebook();
}
function nbRows() {
  const E = nbEnsureEditor(); if (E.cruce) return; const todas = E.texto.split('\n').map(x => x.trim()).filter(Boolean), lines = todas.slice(0, 60), old = E.frases.slice(), used = new Set();
  E.frases = lines.map((l, i) => { const j = old.findIndex((f, k) => !used.has(k) && f.texto === l); if (j >= 0) { used.add(j); return Object.assign({}, old[j], { id: 'f' + (i + 1) }); } return { id: 'f' + (i + 1), texto: l, criterio: '', sinCriterio: false }; });
  if (todas.length > 60) toast('Máximo 60 frases por entrada: se tomaron las 60 primeras. Pasa el resto a otra entrada.', 'err');
  E.dirty = true; renderNotebook();
}
async function nbCross() {
  const E = nbEnsureEditor(); if (E.cruce) return;
  if (!ST.vault.key) { toast('El cuaderno está bloqueado: ábrelo con tu frase (pestaña Cuaderno).', 'err'); if (ST.tab === 'cuaderno') renderNotebook(); return; }
  if (!E.consent) { toast('Marca primero el permiso para registrar lo que dice el piloto (si es menor, el de su tutor): al cruzar, sus frases salen hacia la IA.', 'err'); return; }
  if (!E.sesKey) { toast('Elige primero la sesión de datos.', 'err'); return; }
  if (!nbGateOk(E)) { toast('Escribe tu criterio en cada frase, o marca «Todavía no tengo criterio».', 'err'); return; }
  const x = (ST.hist[ST.perfil] || []).find(y => y.key === E.sesKey); if (!x) { toast('No se encuentra la sesión elegida. Carga las sesiones guardadas.', 'err'); return; }
  busy('Cruzando con los datos…', true);
  try {
    const r = x.rec, M = r.metricas, ids = Object.keys(M).filter(k => k.indexOf('S.') === 0 && !/_hist\d+$/.test(k));
    const previa = r.ia ? 'ANÁLISIS DE DATOS PREVIO (primera pasada, no lo modifiques):\n' + (r.ia.resultado.resumen || '') + '\n' + r.ia.resultado.hallazgos.map(h => '- ' + h.titulo + ': ' + h.interpretacion).join('\n') : 'No hay lectura previa de la IA para esta sesión: usa solo las métricas.';
    const payload = previa + '\n\nMÉTRICAS:\n' + ids.map(k => C.metricLabel(k) ? k + ' = ' + M[k] + ' ' + C.metricUnit(k) + '  (' + C.metricLabel(k) + ')' : k).join('\n') + '\n\nNO VERIFICABLE: ' + (r.noVerificable || []).map(n => n.grupo + ' (falta ' + n.falta + ')').join('; ') + '\n\nFRASES DEL PILOTO (idioma: ' + (E.idioma || 'sin indicar') + '):\n' + E.frases.map(f => f.id + ': ' + f.texto).join('\n');
    const j = await gas('ai', { system: C.systemPromptCuaderno(ST.perfil), messages: [{ role: 'user', content: payload }] });
    const text = (j && j.content ? j.content.map(t => t.text || '').join('') : ''); let parsed; try { parsed = C.parseJSONLoose(text); } catch (e) { throw new Error('La IA no devolvió un JSON legible. Vuelve a intentarlo.'); }
    const canales = (r.canales && r.canales.length ? r.canales : Object.keys(r.mapeo || {})).filter(k => k !== 't' && k !== 'lap');
    const cr = C.validateCuaderno(parsed, E.frases.map(f => ({ id: f.id, texto: f.texto })), M, { canales: canales, hz: r.resumen && r.resumen.hz });
    E.frases.forEach(f => { const c = cr.items.find(i => i.id === f.id) || {}; f.criterioPre = (f.criterio || '').trim(); f.vistoAntes = !f.criterioPre; f.estado = c.estado || 'datos_insuficientes'; f.fuerza = c.fuerza || ''; f.es = c.es || ''; f.vocab = c.vocab || ''; f.comentario = c.comentario || ''; f.evidencia = c.evidencia || []; f.porCodigo = !!c.porCodigo; });
    E.cruce = { ts: new Date().toISOString(), sin_mencionar: cr.sin_mencionar }; E.sello = r.ia ? r.ia.sello : null; E.sealOk = x.sealOk; E.dirty = true; renderNotebook();
  } catch (e) { toast(e.message, 'err'); } finally { busy(''); }
}
async function nbSave() {
  if (ST.saving) return; const E = nbEnsureEditor(), V = ST.vault;
  if (!V.key) { toast('El cuaderno está bloqueado: ábrelo con tu frase (pestaña Cuaderno).', 'err'); if (ST.tab === 'cuaderno') renderNotebook(); return; }
  if (!E.consent) { toast('Marca la casilla de permiso para registrar lo que dice el piloto.', 'err'); return; }
  const x = (ST.hist[ST.perfil] || []).find(y => y.key === E.sesKey); if (!x) { toast('Elige la sesión de datos.', 'err'); return; } if (!E.frases.length) { toast('Escribe al menos una frase del piloto y pulsa «Preparar filas».', 'err'); return; }
  ST.saving = true; busy('Cifrando y guardando…');
  try {
    const id = E.id || ('e' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + Math.random().toString(36).slice(2, 5)), key = NB_E() + id; if (!E.id) E.id = id; /* el id se reserva antes de escribir: si la confirmación se pierde, reintentar sobrescribe la misma entrada */
    if (E.id) { /* no pisar una versión más nueva guardada desde otro aparato */
      let cur = null; try { cur = parseVal(await kvGet(key)); } catch (e) { throw new Error('No se pudo comprobar la versión que hay en el servidor (' + e.message + ').'); }
      if (cur && E.intento && cur.ct && cur.ct === E.intento.ct) { E.rev = +cur.rev || E.rev; } /* es mi escritura anterior, cuya confirmación no llegó: se adopta */
      else if (cur && (+cur.rev || 0) !== (+E.rev || 0)) throw new Error('Otro aparato guardó una versión más nueva de esta entrada (servidor: versión ' + (+cur.rev || 0) + '; la tuya: ' + (+E.rev || 0) + '). No se guardó para no pisarla. Copia lo que escribiste, pulsa «Actualizar» y ábrela de nuevo.');
    }
    let idx = null, rawI = null; try { rawI = await kvGet(NB_IDX()); } catch (e) { throw new Error('No se pudo leer el índice del cuaderno (' + e.message + '). No se tocó nada.'); }
    try { if (rawI != null) { const b = parseVal(rawI); idx = await C.decryptJSON(V.key, b, aadI(b.rev)); } } catch (e) { idx = null; }
    idx = idx && idx.entries ? idx : { n: 0, entries: {} }; (V.entries || []).forEach(e => { if (!idx.entries[e.id]) idx.entries[e.id] = { rev: e.__rev || 1, t: e.sesionResumen || '', ts: e.ts }; });
    const prevRev = Math.max((V.entries || []).find(e => e.id === id) ? V.entries.find(e => e.id === id).__rev : 0, idx.entries[id] ? idx.entries[id].rev : 0), rev = Math.max(prevRev, +E.rev || 0, E.intento ? (+E.intento.rev || 0) : 0) + 1, ts = new Date().toISOString();
    const entry = { v: 2, id: id, ts: ts, creado: E.creado || ts, perfil: E.perfil, sesKey: E.sesKey, sesionResumen: (x.rec.ficha.fecha || '') + ' · ' + (x.rec.ficha.circuito || ''), idioma: E.idioma, piloto: E.piloto, consentimiento: true, texto: E.texto, frases: E.frases, cruce: E.cruce, sello: E.sello, sealOk: E.sealOk, cambios: E.cambios.filter(c => c.cambio || c.resultado), notas: E.notas, rev: rev };
    const blob = await C.encryptJSON(V.key, entry, aadE(key, rev)); blob.rev = rev; blob.salt = V.meta.salt; blob.iter = V.meta.iter; const s = JSON.stringify(blob);
    if (s.length > MAX_CELDA) throw new Error('La entrada es demasiado grande para una celda (' + s.length + ' caracteres). Divídela en dos.');
    E.intento = { rev: rev, ct: blob.ct }; /* por si la escritura llega pero su confirmación se pierde */
    await kvSetVerified(key, s); const back = await C.decryptJSON(V.key, parseVal(await kvGet(key)), aadE(key, rev)); if (back.id !== id) throw new Error('La verificación de lectura no coincide.');
    E.id = id; E.rev = rev; E.creado = entry.creado; E.dirty = false;
    let aviso = ''; try { idx.n = (idx.n || 0) + 1; idx.entries[id] = { rev: rev, t: entry.sesionResumen, ts: ts }; const ib = await C.encryptJSON(V.key, idx, aadI(idx.n)); ib.rev = idx.n; await kvSetVerified(NB_IDX(), JSON.stringify(ib)); } catch (e) { aviso = ' El índice no se actualizó (' + e.message + '): la entrada sí está guardada.'; }
    await nbRefresh(true); toast('Entrada guardada cifrada y verificada ✓' + aviso, aviso ? 'err' : 'ok'); renderNotebook();
  } catch (e) { toast('NO se guardó: ' + e.message, 'err'); } finally { ST.saving = false; busy(''); nbIdleReset(); }
}
async function nbBackup() {
  busy('Preparando la copia…'); const V = ST.vault;
  try { const meta = await kvGet(NB_META()), idx = await kvGet(NB_IDX()), items = await kvDump(NB_E()); descarga(JSON.stringify({ tipo: 'AD11-cuaderno-copia', version: 1, usuario: ST.user, fecha: new Date().toISOString(), meta: meta, indice: idx, entradas: items.map(it => ({ clave: it[0], valor: it[1] })) }), 'cuaderno-copia-' + localDate() + '.json'); V.recienCreado = false; toast('Copia descargada (sigue cifrada: solo se abre con tu frase). Guárdala fuera de este aparato.', 'ok'); if (ST.tab === 'cuaderno' && V.state === 'abierto') renderNotebook(); }
  catch (e) { toast('No se pudo preparar la copia: ' + e.message, 'err'); } finally { busy(''); }
}
function nbOpen(id) {
  const e = (ST.vault.entries || []).find(x => x.id === id); if (!e) return;
  if (nbDirty() && !confirm('Tienes una entrada sin guardar. Si abres otra se pierde. ¿Abrir?')) return;
  ST.nb = { id: e.id, rev: e.__rev || e.rev || 0, creado: e.creado || e.ts || '', perfil: e.perfil || ST.perfil, sesKey: e.sesKey || '', idioma: e.idioma || '', piloto: e.piloto || '', consent: !!e.consentimiento, texto: e.texto || '', frases: (e.frases || []).map(f => Object.assign({}, f)), cruce: e.cruce || null, cambios: (e.cambios && e.cambios.length ? e.cambios.map(c => Object.assign({}, c)) : [{ cambio: '', resultado: '' }]), notas: e.notas || '', sello: e.sello || null, sealOk: e.sealOk == null ? null : e.sealOk, dirty: false };
  renderNotebook(); window.scrollTo(0, 0);
}

/* ===================== login ===================== */
async function doLogin() {
  const u = $('loginUser').value.trim(), p = $('loginPass').value; $('loginErr').textContent = '';
  if (!u || !p) { $('loginErr').textContent = 'Escribe usuario y clave.'; return; }
  try {
    const j = await gas('login', { user: u, pass: p }); if (!j || !j.token) { $('loginErr').textContent = 'Usuario o clave incorrectos.'; return; }
    const otro = !!ST.user && !ST.demo && ST.user.toLowerCase() !== u.toLowerCase(); /* otro usuario en la misma pestaña: se recarga para que no vea ni conserve nada del anterior */
    TOKEN = j.token; ST.user = u; STORE.set(TOKEN_KEY, TOKEN); STORE.set(USER_KEY, u); if (otro) { TOKEN = null; ST.vault.key = null; ST.nb = null; location.reload(); return; } $('loginOverlay').style.display = 'none'; $('loginPass').value = ''; ST.vault = { key: null, meta: null, state: 'desconocido', entries: [], avisos: [], err: '', listaError: '' }; afterLogin(); if (ST.tab === 'cuaderno') renderNotebook();
  } catch (e) { $('loginErr').textContent = e.message; }
}
function afterLogin() { $('logoutBtn').hidden = false; $('who').textContent = ST.demo ? 'MODO DEMOSTRACIÓN (sin servidor) · tus cifras se calculan aquí; no se guarda nada y la lectura IA es de ejemplo' : (ST.user || ''); }
function logout() {
  if (nbDirty() && !confirm('Tienes una entrada del cuaderno sin guardar. Si sales se pierde. ¿Salir?')) return;
  if (!ST.demo) { STORE.del(TOKEN_KEY); STORE.del(USER_KEY); }
  TOKEN = null; ST.vault.key = null; ST.nb = null; location.reload();
}
function startDemo(desdeArranque) { if (!desdeArranque && ST.user && !ST.demo) { try { sessionStorage.setItem('ad11_2d_demo', '1'); } catch (e) { } ST.vault.key = null; ST.nb = null; location.reload(); return; } /* vengo de una sesión real caducada: recarga para no mostrar sus datos en la demostración */ ST.demo = true; ST.user = 'demo'; $('loginOverlay').style.display = 'none'; ST.vault = { key: null, meta: null, state: 'desconocido', entries: [], avisos: [], err: '', listaError: '' }; afterLogin(); }

/* ===================== ejemplo sintético (solo para probar la pantalla) ===================== */
function demoCSV() {
  const hz = 25, lapT = 62, laps = 7, N = hz * lapT * laps, f = (v, d) => (ST.perfil === '2d-moto4' ? v.toFixed(d).replace('.', ',') : v.toFixed(d)), sep = ST.perfil === '2d-moto4' ? ';' : ',';
  const hdr = ['Time [s]', 'Lap', 'GPS Speed [km/h]', 'RPM', 'Throttle [%]', 'V Rear [km/h]', 'V Front [km/h]', 'Susp F [mm]', 'Susp R [mm]', 'Brake F [bar]', 'Water Temp [°C]'];
  const rows = [hdr.join(sep)]; let seed = 5; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const vf = ph => 105 + 52 * Math.sin(3 * ph) + 22 * Math.sin(5 * ph + 1); let pv = vf(0);
  for (let i = 0; i < N; i++) {
    const t = i / hz, lap = Math.floor(t / lapT) + 1, ph = (t % lapT) / lapT * 2 * Math.PI, v = vf(ph), a = (v - pv) / 3.6 * hz; pv = v;
    const tps = a > 0.6 ? 100 : (a < -0.9 ? 0 : 30), brk = a < -0.9 ? Math.min(60, -a * 9) : 0, gear = v < 70 ? 2 : v < 100 ? 3 : v < 125 ? 4 : v < 150 ? 5 : 6, rpm = v * (12800 / [0, 60, 88, 116, 145, 174, 210][gear]);
    rows.push([f(t, 3), lap, f(v + rnd(), 1), f(rpm, 0), f(tps, 0), f(v * 1.004 + rnd() * 0.5 + (lap === 5 && ph > 2 && ph < 2.4 ? 9 : 0), 1), f(v + rnd() * 0.5, 1), f(Math.min(114.5, Math.max(1.5, 40 - a * 2.2 + rnd() * 2 + (lap === 4 && a < -3 ? 44 : 0))), 1), f(32 + a * 3 + rnd(), 1), f(brk, 1), f(65 + t / 60 * 1.2, 1)].join(sep));
  }
  return rows.join('\n');
}

/* ===================== eventos ===================== */
const ACTIONS = {
  tab: el => { if (el.dataset.v !== ST.tab) setTab(el.dataset.v); }, prof: el => setPerfil(el.dataset.v), pick: () => $('fileIn').click(), login: doLogin, logout: logout,
  startDemo: () => startDemo(false), demo: () => { const t = demoCSV(); return useText(t, 'EJEMPLO_sintetico.csv', t.length, 'utf-8'); },
  cancelBusy: () => { if (CTRL) { CTRL.cancelado = true; CTRL.abort(); } busy(''); },
  saveMap: saveMapping, confirmAll: confirmAll, applyMap: async () => { const P = PS(); if (!P.table) return; if (!mapOwnerOk()) { toast('Elige primero la moto en la ficha.', 'err'); return; } busy('Aplicando…'); try { const n = await applySavedMapping(P); toast(n ? 'Mapeo guardado aplicado (' + n + ' canales). Mira el rango observado.' : 'No hay mapeo guardado para esta moto, o ninguna columna coincide.', n ? 'ok' : 'err'); if (n) markDirty(); if (P.fichaRecordada) { P.fichaRecordada = false; renderCargar(); } else renderMapping(); } finally { busy(''); } },
  analyze: () => runAnalysis(false), recalc: () => runAnalysis(true), askAI: askAI, save: saveSession,
  loadHist: async () => { await loadHistory(true); if (ST.tab === 'analisis') renderAnalysis(); else if (ST.tab === 'historial') renderHistory(); else renderNotebook(); }, reloadHist: async () => { await loadHistory(true); renderHistory(); },
  viewSes: el => viewSession(el.dataset.v), useBase: el => { const x = (ST.hist[ST.perfil] || []).find(y => y.key === el.dataset.v); if (x) { const bad = baseRechazo(x); if (bad) { toast(bad, 'err'); return; } PS().base = x; toast('Base elegida. Se usará en la pestaña Análisis.', 'ok'); } },
  nbCreate: nbCreate, nbUnlock: nbUnlock, nbRecover: nbRecover, nbLock: nbLock, nbBackup: nbBackup, nbRetry: () => { ST.vault.state = 'desconocido'; renderNotebook(); }, nbRows: nbRows, nbCross: nbCross, nbSave: nbSave,
  nbNew: () => { if (nbDirty() && !confirm('Tienes una entrada sin guardar. Si abres una nueva se pierde. ¿Seguir?')) return; ST.nb = null; renderNotebook(); },
  nbOpen: el => nbOpen(el.dataset.v), nbRefresh: () => nbRefresh(false),
  nbAddChange: () => { const E = nbEnsureEditor(); E.cambios.push({ cambio: '', resultado: '' }); E.dirty = true; renderNotebook(); }
};
document.addEventListener('click', e => { const el = e.target.closest('[data-act]'); if (!el) return; const f = ACTIONS[el.dataset.act]; if (f) { e.preventDefault(); let r; try { r = f(el, e); } catch (er) { toast(er.message, 'err'); return; } if (r && r.catch) r.catch(er => { if (er.code !== 'CANCEL') toast(er.message, 'err'); }); } });
document.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.target.id === 'loginPass' || e.target.id === 'loginUser')) doLogin(); if ((e.key === 'Enter' || e.key === ' ') && e.target.id === 'drop') { e.preventDefault(); $('fileIn').click(); } });
function baseRechazo(x) { const P = PS(); if (P.recId && x.key === 's2:' + ST.perfil + ':' + P.recId) return 'Esa es la sesión que tienes abierta: elige otra como base.'; if (x.sealOk === false) return 'La huella de esa sesión no coincide (se alteró después de guardarse): no se usa como base.'; return ''; }
const CALC_META = { travelF: 1, travelR: 1, rpmLimite: 1, aguaAviso: 1 };
function onBind(el) {
  const P = PS(), path = el.dataset.bind.split('.'), g = path[0], k = path[1], v = el.value;
  if (g === 'meta') { P.meta[k] = v; tocar(P, k); if (CALC_META[k]) markDirty(); } else if (g === 'setup') { P.setup[k] = v; }
  else if (g === 'top') {
    if (k === 'hz') { P.hz = v; markDirty(); } else if (k === 'sens') { P.sens = v; if (ST.tab === 'analisis') renderAnalysis(); }
    else if (k === 'base') { const x = v ? (ST.hist[ST.perfil] || []).find(y => y.key === v) || null : null; const bad = x ? baseRechazo(x) : ''; if (bad) { toast(bad, 'err'); P.base = null; } else P.base = x; renderAnalysis(); }
  }
}
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'fileIn') { if (t.files[0]) loadFile(t.files[0]); t.value = ''; return; }
  if (t.dataset.bind) onBind(t);
  if (t.dataset.parse) { PS().parse[t.dataset.parse] = t.value; reparse(false); }
  if (t.dataset.map) onMapCol(t.dataset.map, t.value);
  if (t.dataset.mapf) { const [c, f] = t.dataset.mapf.split(':'); onMapField(c, f, t); }
  if (t.dataset.conf) onMapConf(t.dataset.conf, t);
  if (t.dataset.lap) { const P = PS(), y = window.scrollY; P.override[+t.dataset.lap] = t.checked; runAnalysis(true).then(() => window.scrollTo(0, y)); }
  if (t.dataset.chart) { const P = PS(); if (t.dataset.chart === 'ch') P.chartCh = t.value; else { const n = +t.value; P.chartLaps = P.chartLaps.filter(x => x !== n); if (t.checked) P.chartLaps.push(n); P.chartLaps = P.chartLaps.slice(-4); } drawCharts(); }
  if (t.dataset.nb === 'sesKey') { const E = nbEnsureEditor(); E.sesKey = t.value; E.dirty = true; }
  if (t.dataset.nb === 'consent') { const E = nbEnsureEditor(); E.consent = t.checked; E.dirty = true; nbGate(); if (ST.tab === 'cuaderno' && !E.cruce) renderNotebook(); }
  if (t.dataset.nbr !== undefined) { const E = nbEnsureEditor(); if (E.frases[+t.dataset.nbr]) { E.frases[+t.dataset.nbr].acierto = t.value; E.dirty = true; } }
  if (t.dataset.nbs !== undefined) { const E = nbEnsureEditor(); E.frases[+t.dataset.nbs].sinCriterio = t.checked; E.dirty = true; nbGate(); }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.bind && (t.dataset.bind.indexOf('meta.') === 0 || t.dataset.bind.indexOf('setup.') === 0 || t.dataset.bind === 'top.hz')) onBind(t);
  if (t.dataset.nb && t.dataset.nb !== 'sesKey' && t.dataset.nb !== 'consent') { const E = nbEnsureEditor(); E[t.dataset.nb] = t.value; E.dirty = true; }
  if (t.dataset.nbf !== undefined) { const E = nbEnsureEditor(); E.frases[+t.dataset.nbf].criterio = t.value; E.dirty = true; nbGate(); }
  if (t.dataset.nbc) { const E = nbEnsureEditor(); const [i, f] = t.dataset.nbc.split(':'); E.cambios[+i][f] = t.value; E.dirty = true; }
});
let nbIdle = null; function nbIdleReset() { clearTimeout(nbIdle); nbIdle = setTimeout(() => { if (ST.vault && ST.vault.state === 'abierto' && !nbDirty() && !ST.saving) { nbLock(); toast('El cuaderno se bloqueó tras 15 minutos sin uso.', 'ok'); } }, 15 * 60 * 1000); }
['click', 'keydown', 'input', 'touchstart'].forEach(ev => document.addEventListener(ev, nbIdleReset, true)); ['scroll', 'wheel'].forEach(ev => document.addEventListener(ev, nbIdleReset, { capture: true, passive: true })); nbIdleReset();
window.addEventListener('beforeunload', e => { if (nbDirty()) { e.preventDefault(); e.returnValue = ''; } });
const dz = $('drop');
['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
dz.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) loadFile(f); });

/* ===================== arranque ===================== */
renderProfSeg(); renderTabs(); renderCargar();
let quiereDemo = false; try { quiereDemo = sessionStorage.getItem('ad11_2d_demo') === '1'; sessionStorage.removeItem('ad11_2d_demo'); } catch (e) { }
if (quiereDemo) startDemo(true); else if (!TOKEN) needLogin(); else afterLogin();
