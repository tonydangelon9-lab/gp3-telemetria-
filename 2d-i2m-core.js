/* 2d-i2m-core.js · AD11 Racing · núcleo de cálculo SIN pantalla ni red.
   Aquí vive todo lo que se puede comprobar con números: perfiles 2D+Moto4 e I2M+Ducati,
   lector de CSV tolerante, mapeo de canales, vueltas, métricas, reglas, validación de la IA
   y la bóveda cifrada del cuaderno. La página (2d-i2m.html) solo lo muestra y lo guarda.
   Funciona en el navegador (window.TeleCore) y en Node (para las pruebas). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.TeleCore = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const VERSION = '2d-i2m-core 1.1';

  /* =====================================================================
     1. Utilidades
     ===================================================================== */
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const strip = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  const norm = s => strip(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
  function finiteSorted(a, i0, i1) {
    const out = [];
    for (let i = i0; i < i1; i++) { const v = a[i]; if (v === v && v !== Infinity && v !== -Infinity) out.push(v); }
    out.sort((x, y) => x - y);
    return out;
  }
  function pctl(sorted, p) {
    const n = sorted.length; if (!n) return NaN; if (n === 1) return sorted[0];
    const x = p * (n - 1), lo = Math.floor(x), hi = Math.ceil(x);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (x - lo);
  }
  function mean(a, i0, i1) { let s = 0, c = 0; for (let i = i0; i < i1; i++) { const v = a[i]; if (v === v && isFinite(v)) { s += v; c++; } } return c ? s / c : NaN; }
  function maxOf(a, i0, i1) { let m = -Infinity; for (let i = i0; i < i1; i++) { const v = a[i]; if (v === v && v > m) m = v; } return m === -Infinity ? NaN : m; }
  function minOf(a, i0, i1) { let m = Infinity; for (let i = i0; i < i1; i++) { const v = a[i]; if (v === v && v < m) m = v; } return m === Infinity ? NaN : m; }
  function rnd(v, d) { if (!isNum(v)) return null; const f = Math.pow(10, d == null ? 2 : d); return Math.round(v * f) / f; }
  function movAvg(a, w) { // media móvil centrada, tolera NaN
    const n = a.length, out = new Float64Array(n); w = Math.max(1, w | 0);
    const ps = new Float64Array(n + 1), pc = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) { const v = a[i]; const ok = v === v && isFinite(v); ps[i + 1] = ps[i] + (ok ? v : 0); pc[i + 1] = pc[i] + (ok ? 1 : 0); }
    const h = w >> 1;
    for (let i = 0; i < n; i++) { const lo = Math.max(0, i - h), hi = Math.min(n, i + h + 1); const c = pc[hi] - pc[lo]; out[i] = c ? (ps[hi] - ps[lo]) / c : NaN; }
    return out;
  }
  function median(arr) { const s = finiteSorted(arr, 0, arr.length); return pctl(s, 0.5); }

  /* =====================================================================
     2. Catálogo de canales y perfiles
     ===================================================================== */
  const CANALES = {
    t: { label: 'Tiempo', unit: 's' },
    lap: { label: 'Número de vuelta', unit: '' },
    gps_speed: { label: 'Velocidad GPS', unit: 'km/h' },
    lat: { label: 'Latitud GPS', unit: '°' },
    lon: { label: 'Longitud GPS', unit: '°' },
    rpm: { label: 'RPM del motor', unit: 'rpm' },
    tps: { label: 'Acelerador', unit: '%' },
    v_rear: { label: 'Velocidad rueda trasera', unit: 'km/h' },
    v_front: { label: 'Velocidad rueda delantera', unit: 'km/h' },
    susp_f: { label: 'Suspensión delantera', unit: 'mm' },
    susp_r: { label: 'Suspensión trasera', unit: 'mm' },
    brake_f: { label: 'Presión de freno delantero', unit: 'bar' },
    brake_r: { label: 'Presión de freno trasero', unit: 'bar' },
    water_temp: { label: 'Temperatura de agua', unit: '°C' },
    lambda: { label: 'Lambda', unit: 'λ' },
    gear: { label: 'Marcha', unit: '' },
    lean: { label: 'Ángulo de inclinación', unit: '°' },
    pitch: { label: 'Ángulo de cabeceo', unit: '°' },
    tq_slow: { label: 'Reducción de par lenta', unit: '%' },
    tq_fast: { label: 'Reducción de par rápida', unit: '%' },
    tc_level: { label: 'Nivel de control de tracción', unit: '' },
    ebc_level: { label: 'Nivel de freno motor', unit: '' },
    map_level: { label: 'Mapa / modo', unit: '' },
    dwc_level: { label: 'Nivel DWC (control de caballito)', unit: '' },
    dsc_level: { label: 'Nivel DSC', unit: '' },
    clutch: { label: 'Embrague', unit: '' },
    air_temp: { label: 'Temperatura de aire', unit: '°C' },
    battery: { label: 'Batería', unit: 'V' },
    acc_x: { label: 'Aceleración X', unit: '' },
    acc_y: { label: 'Aceleración Y', unit: '' },
    yaw_rate: { label: 'Velocidad de guiñada', unit: '°/s' },
    pitch_rate: { label: 'Velocidad de cabeceo', unit: '°/s' },
    roll_rate: { label: 'Velocidad de balanceo', unit: '°/s' }
  };

  // kit: 'incluido' | 'opcional' | 'fuera' (no está en la lista del reglamento 2019) | 'can' (llega por el CAN de la moto) | 'analogico' (sensor externo)
  const PERFILES = {
    '2d-moto4': {
      id: '2d-moto4',
      etiqueta: '2D · Moto4',
      titulo: '2D Datarecording en la Moto4 (Honda NSF250R)',
      sistema: '2D', categoria: 'Moto4',
      moto: { marca: 'Honda', modelo: 'NSF250R' },
      unidades: { min: 1, max: 16, etiqueta: 'Número de moto (1 a 16)' },
      archivo: 'Exportación de 2D Analyzer (CSV / ASCII). Formato real sin confirmar: el lector detecta separador, decimal y cabecera.',
      exportacion: 'Para exportar necesitas un ordenador (portátil) con el programa de 2D (2D Analyzer): no se puede desde el teléfono. Qué licencia del programa permite exportar CSV/ASCII está por confirmar con 2D / CSR Motorsport.',
      marchas: 6,
      canales: {
        t: { kit: 'incluido', aliases: ['time', 'tiempo', 't', 'timestamp', 'elapsed', 'elapsedtime', 'timems', 'times', 'tempo', 'seconds'] },
        lap: { kit: 'incluido', aliases: ['lap', 'lapno', 'lapnumber', 'lapnum', 'laps', 'vuelta', 'nvuelta', 'numerovuelta'] },
        gps_speed: { kit: 'incluido', aliases: ['gpsspeed', 'speedgps', 'gpsvel', 'velgps', 'velocidadgps', 'vgps', 'gpsv', 'gpskmh', 'gpsspd'] },
        lat: { kit: 'incluido', aliases: ['lat', 'latitude', 'latitud', 'gpslat', 'gpslatitude'] },
        lon: { kit: 'incluido', aliases: ['lon', 'long', 'lng', 'longitude', 'longitud', 'gpslon', 'gpslong', 'gpslongitude'] },
        rpm: { kit: 'incluido', aliases: ['rpm', 'enginerpm', 'enginespeed', 'motorrpm', 'rpmmotor', 'revs', 'revolutions'] },
        tps: { kit: 'incluido', aliases: ['throttle', 'tps', 'throttleposition', 'throttlepos', 'aperturagas', 'acelerador', 'gas', 'aps', 'ths', 'thr'] },
        v_rear: { kit: 'incluido', aliases: ['vrear', 'rearspeed', 'speedrear', 'velrear', 'velocidadtrasera', 'vtrasera', 'wheelspeedrear', 'rearwheelspeed', 'veltras', 'vreartyre', 'vhinten'] },
        v_front: { kit: 'opcional', aliases: ['vfront', 'frontspeed', 'speedfront', 'velfront', 'velocidaddelantera', 'vdelantera', 'wheelspeedfront', 'frontwheelspeed', 'veldel', 'vvorn'] },
        susp_f: { kit: 'incluido', aliases: ['suspf', 'suspfront', 'frontsusp', 'fork', 'forkpos', 'forkposition', 'horquilla', 'suspdelantera', 'suspdel', 'suspensionfront', 'sdel', 'fsusp', 'suspfr'] },
        susp_r: { kit: 'incluido', aliases: ['suspr', 'susprear', 'rearsusp', 'shock', 'shockpos', 'shockposition', 'amortiguador', 'susptrasera', 'susptras', 'suspensionrear', 'stras', 'rsusp', 'susprr'] },
        brake_f: { kit: 'opcional', aliases: ['brakef', 'brakefront', 'frontbrake', 'brakepressf', 'brakepressurefront', 'frenodelantero', 'presfrenodel', 'pbrakef', 'bpf', 'brakefr'] },
        brake_r: { kit: 'opcional', aliases: ['braker', 'brakerear', 'rearbrake', 'brakepressr', 'brakepressurerear', 'frenotrasero', 'presfrenotras', 'pbraker', 'bpr', 'brakerr'] },
        water_temp: { kit: 'opcional', aliases: ['twater', 'watertemp', 'watertemperature', 'tempagua', 'temperaturaagua', 'coolant', 'ect', 'tempmotor', 'enginetemp'] },
        lambda: { kit: 'opcional', aliases: ['laf', 'lambda', 'afr', 'lambda1', 'lsu'] },
        gear: { kit: 'fuera', aliases: ['gear', 'marcha', 'gearpos', 'gearposition'] },
        acc_x: { kit: 'fuera', aliases: ['accx', 'ax', 'accelx', 'accelerationx'] },
        acc_y: { kit: 'fuera', aliases: ['accy', 'ay', 'accely', 'accelerationy'] },
        roll_rate: { kit: 'fuera', aliases: ['gyro', 'gyroroll', 'rollrate', 'gyrox'] }
      },
      // Medidas que el reglamento ETC 2019 permite como entradas externas; lo demás se marca "fuera de la lista".
      reglamento: 'ETC 2019 Apéndice 7 (desactualizado; el texto 2026 no se pudo abrir). Entradas externas permitidas: GPS, agua, lambda, TPS, RPM, velocidad de rueda delantera y trasera, presión de freno delantero y trasero, horquilla y amortiguador. La telemetría en vivo no está permitida: solo análisis posterior.',
      trabajosPermitidos: ['muelle de horquilla', 'muelle del amortiguador', 'cantidad y calidad (viscosidad) del aceite de horquilla y amortiguador', 'válvulas y pistones internos', 'pastillas', 'discos', 'bomba de freno', 'cadena y piñones'],
      ajustesExternos: false // hasta confirmar que existen "clics" externos, no se recomiendan clics
    },
    'i2m-ducati': {
      id: 'i2m-ducati',
      etiqueta: 'I2M · Ducati',
      titulo: 'I2M DataLog Pro en Ducati (V4 R 2023 y V4 2025)',
      sistema: 'I2M', categoria: 'Ducati',
      motos: [
        { id: 'v4r-2023', nombre: 'Ducati V4 R 2023' },
        { id: 'v4-2025', nombre: 'Ducati V4 2025 (versión exacta por confirmar)' }
      ],
      unidades: null,
      archivo: 'CSV exportado con Danas (el programa de I2M). Los nombres de canal los define el equipo: la primera vez se confirma el mapeo canal por canal y queda guardado por moto.',
      exportacion: 'Para exportar necesitas un ordenador (portátil) con Danas, el programa de I2M (Windows o Mac): no se puede desde el teléfono. Los canales CAN de la Ducati V4 R 2023 y V4 2025 con el DataLog Pro están POR CONFIRMAR con I2M hasta ver un archivo real.',
      marchas: 6,
      canPorConfirmar: true,
      canales: {
        t: { kit: 'incluido', aliases: ['time', 'tiempo', 't', 'timestamp', 'elapsed', 'elapsedtime', 'timems', 'times', 'tempo'] },
        lap: { kit: 'incluido', aliases: ['lap', 'lapno', 'lapnumber', 'lapnum', 'laps', 'vuelta', 'giro', 'nvuelta'] },
        gps_speed: { kit: 'incluido', aliases: ['gpsspeed', 'speedgps', 'gps', 'velgps', 'velocitagps', 'velocidadgps', 'gpsvel', 'gpsspd', 'gpskmh'] },
        lat: { kit: 'incluido', aliases: ['lat', 'latitude', 'latitud', 'gpslat', 'latitudine'] },
        lon: { kit: 'incluido', aliases: ['lon', 'long', 'lng', 'longitude', 'longitud', 'gpslon', 'gpslong', 'longitudine'] },
        rpm: { kit: 'can', aliases: ['rpm', 'enginerpm', 'enginespeed', 'motorrpm', 'giri'] },
        tps: { kit: 'can', aliases: ['apsthrottle', 'aps', 'tpsh', 'tpshv', 'analog1', 'throttle', 'tps', 'gas', 'acceleratore', 'acelerador'] },
        v_rear: { kit: 'can', aliases: ['spd1', 'speed1', 'rearspeed', 'speedrear', 'vrear', 'vel1', 'velocidadtrasera'] },
        v_front: { kit: 'can', aliases: ['vel2', 'spd2', 'speed2', 'frontspeed', 'speedfront', 'vfront', 'velocidaddelantera'] },
        gear: { kit: 'can', aliases: ['gear', 'gearinuse', 'multi7', 'marcha', 'marciainserita'] },
        lean: { kit: 'can', aliases: ['leanangle', 'lean', 'ext3', 'inclinazione', 'angoloinclinazione', 'bankangle', 'roll'] },
        pitch: { kit: 'can', aliases: ['pitchangle', 'ext4', 'beccheggio', 'anglepitch'] },
        tq_slow: { kit: 'can', aliases: ['torquereductionslow', 'tqslow', 'torquereds', 'torqueredslow', 'ext1', 'torquereductionslowpercent'] },
        tq_fast: { kit: 'can', aliases: ['torquereductionfast', 'tqfast', 'torqueredf', 'torqueredfast', 'ext2', 'torquereductionfastpercent'] },
        water_temp: { kit: 'can', aliases: ['watertemperature', 'watertemp', 'multi1', 'tempagua', 'temperaturaagua', 'coolant', 'tacqua'] },
        air_temp: { kit: 'can', aliases: ['airtemperature', 'airtemp', 'multi4', 'tempaire'] },
        battery: { kit: 'can', aliases: ['batterylevel', 'battery', 'multi3', 'vbatt', 'bateria'] },
        map_level: { kit: 'can', aliases: ['map', 'multi6', 'mappa', 'mapa', 'ridingmode', 'mode'] },
        tc_level: { kit: 'can', aliases: ['tclevel', 'multi5', 'dtclevel', 'tractioncontrol', 'controldetraccion'] },
        dwc_level: { kit: 'can', aliases: ['dwclevel', 'multi8', 'dwc'] },
        dsc_level: { kit: 'can', aliases: ['dsclevel', 'multi9', 'dsc'] },
        ebc_level: { kit: 'can', aliases: ['ebclevel', 'multi10', 'ebc', 'enginebrake', 'frenomotor'] },
        clutch: { kit: 'can', aliases: ['clutchstatus', 'can1', 'clutch', 'frizione', 'embrague'] },
        acc_x: { kit: 'can', aliases: ['accelerationx', 'accx', 'longitudinalg', 'can5', 'ax', 'accelx'] },
        acc_y: { kit: 'can', aliases: ['accelerationy', 'accy', 'lateralg', 'can6', 'ay', 'accely'] },
        yaw_rate: { kit: 'can', aliases: ['yawrate', 'can7', 'yaw'] },
        pitch_rate: { kit: 'can', aliases: ['pitchrate', 'can8'] },
        roll_rate: { kit: 'can', aliases: ['rollrate', 'can9'] },
        susp_f: { kit: 'analogico', aliases: ['suspf', 'suspfront', 'frontsusp', 'fork', 'forkpos', 'horquilla', 'suspdelantera', 'suspdel', 'forcella', 'potfork'] },
        susp_r: { kit: 'analogico', aliases: ['suspr', 'susprear', 'rearsusp', 'shock', 'shockpos', 'amortiguador', 'susptrasera', 'susptras', 'mono', 'potshock'] },
        brake_f: { kit: 'analogico', aliases: ['brakef', 'brakefront', 'frontbrake', 'brakepressure', 'brake', 'freno', 'frenodelantero', 'pressionefreno', 'pbrake'] },
        brake_r: { kit: 'analogico', aliases: ['braker', 'brakerear', 'rearbrake', 'frenotrasero'] },
        lambda: { kit: 'analogico', aliases: ['lambda', 'lsu', 'laf', 'afr'] }
      },
      reglamento: 'Campeonato y reglamento desconocidos: la app no evalúa cumplimiento. Según el manual plug&play de I2M (v1.70), sus kits son para uso exclusivo en pista.',
      trabajosPermitidos: null, // sin reglamento conocido: se muestran como hipótesis, sin lista cerrada
      ajustesExternos: true
    }
  };

  /* Vocabulario controlado del piloto: frase → firma en los datos → sensores.
     calc: 'sesion' = la app calcula una cifra de SESIÓN que puede apoyar o contradecir la frase;
           'indicio' = hay una cifra que solo puede apoyar («compatible con»), nunca contradecir;
           'no' = la app NO calcula esta firma (se queda en «datos insuficientes» aunque haya sensores). */
  const VOCAB = [
    { id: 'delantero_empuja', en: ['front end pushing', 'understeer', 'front pushes'], es: ['el delantero empuja', 'subvira', 'empuja el delantero'], pt: ['a frente empurra', 'subvira'], it: ['il anteriore spinge', 'sottosterzo'], firma: 'Entrada y mitad de curva: trazada más abierta y velocidad mínima menor que la vuelta de referencia; recorrido de horquilla distinto de su base', sensores: ['susp_f', 'gps_speed'], calc: 'indicio', kit2d: 'parcial' },
    { id: 'delantero_vago', en: ["can't feel the front", 'vague front'], es: ['no pisa el delantero', 'delantero vago', 'no siento el delantero'], pt: ['nao sinto a frente'], it: ['non sento l anteriore'], firma: 'Poco recorrido o poca variación de la horquilla en entrada y mitad de curva frente a su base; suelta rápida del freno', sensores: ['susp_f', 'brake_f'], calc: 'indicio', kit2d: 'parcial' },
    { id: 'vibra', en: ['chatter'], es: ['vibra', 'trepida'], pt: ['vibra', 'trepida'], it: ['vibra', 'chatter'], firma: 'Oscilación repetida de alta frecuencia en la suspensión en zonas concretas', sensores: ['susp_f', 'susp_r'], calc: 'no', kit2d: 'parcial' },
    { id: 'flota', en: ['wallowing', 'floaty'], es: ['flota', 'balanceo lento'], pt: ['flutua'], it: ['galleggia'], firma: 'Oscilaciones lentas y poco amortiguadas tras una transición, con recorrido amplio', sensores: ['susp_f', 'susp_r'], calc: 'no', kit2d: 'parcial' },
    { id: 'bombea', en: ['pumping', 'packing down'], es: ['bombea', 'se va hundiendo'], pt: ['bombeia', 'vai afundando'], it: ['pompa', 'si siede'], firma: 'Deriva descendente de la posición media en una serie de golpes; extensión más lenta que compresión', sensores: ['susp_f', 'susp_r'], calc: 'no', kit2d: 'parcial' },
    { id: 'fondo', en: ['bottoming'], es: ['va al fondo', 'topea', 'toca fondo'], pt: ['vai ao fundo', 'bate no fundo'], it: ['va a fondo corsa', 'finecorsa'], firma: 'Posición en el extremo del recorrido calibrado y tiempo en el extremo', sensores: ['susp_f', 'susp_r'], calc: 'sesion', kit2d: 'si' },
    { id: 'extension_tope', en: ['topping out'], es: ['se extiende demasiado', 'se queda colgada'], pt: ['estende demais'], it: ['si estende troppo'], firma: 'Posición repetida en extensión máxima', sensores: ['susp_f', 'susp_r'], calc: 'indicio', kit2d: 'si' },
    { id: 'trasera_patina', en: ['rear spinning', 'wheelspin on exit'], es: ['patina la trasera', 'se va al abrir', 'patina de atras'], pt: ['a traseira patina', 'patina a traseira'], it: ['il posteriore pattina', 'slitta il posteriore'], firma: 'Rueda trasera sobre la rueda delantera tras abrir el gas', sensores: ['v_rear', 'v_front', 'tps'], calc: 'sesion', kit2d: 'parcial' },
    { id: 'trasera_suelta', en: ['rear stepping out', 'loose rear'], es: ['se cruza la trasera', 'trasera suelta', 'se va de atras'], pt: ['a traseira escapa', 'a traseira solta'], it: ['il posteriore scivola', 'posteriore che scappa'], firma: 'Variaciones rápidas de la velocidad de rueda trasera y de la guiñada', sensores: ['yaw_rate', 'v_rear'], calc: 'no', kit2d: 'no' },
    { id: 'trasera_salta', en: ['rear hopping', 'rear chatter on downshift'], es: ['la trasera salta al reducir', 'rebota al reducir', 'la trasera rebota'], pt: ['a traseira salta ao reduzir'], it: ['il posteriore salta in scalata'], firma: 'Velocidad trasera cae u oscila frente a la delantera o al GPS al reducir', sensores: ['v_rear', 'v_front', 'rpm'], calc: 'no', kit2d: 'parcial' },
    { id: 'freno_motor', en: ['engine braking'], es: ['freno motor', 'frena mucho el motor'], pt: ['freio motor'], it: ['freno motore'], firma: 'Deceleración con gas cerrado y su efecto en la rueda trasera', sensores: ['v_rear', 'tps', 'rpm'], calc: 'no', kit2d: 'parcial' },
    { id: 'delantero_bloquea', en: ['front locking', 'front lock up'], es: ['se bloquea el delantero', 'bloquea la rueda delantera'], pt: ['a frente trava', 'trava a roda da frente'], it: ['si blocca l anteriore', 'bloccaggio anteriore'], firma: 'Velocidad delantera cae bajo la trasera o el GPS con presión de freno alta', sensores: ['v_front', 'brake_f'], calc: 'sesion', kit2d: 'no' },
    { id: 'delantero_cierra', en: ['tucking the front', 'front tuck'], es: ['se cierra el delantero', 'cierra el delantero'], pt: ['a frente fecha'], it: ['si chiude l anteriore'], firma: 'Pérdida de agarre del delantero en curva con inclinación; no coincide con un bloqueo en frenada', sensores: ['v_front', 'lean'], calc: 'no', kit2d: 'no' },
    { id: 'caballito', en: ['wheelie'], es: ['levanta la rueda', 'caballito'], pt: ['empina', 'cavalinho'], it: ['impenna', 'cavallino'], firma: 'Horquilla en extensión máxima con TPS alto en marchas bajas', sensores: ['susp_f', 'tps'], calc: 'indicio', kit2d: 'parcial' },
    { id: 'stoppie', en: ['stoppie'], es: ['la trasera se levanta al frenar'], pt: ['a traseira levanta ao frear'], it: ['il posteriore si alza in frenata'], firma: 'Recorrido trasero en extensión máxima en frenada fuerte; cae la velocidad de la trasera', sensores: ['susp_r', 'v_rear', 'brake_f'], calc: 'no', kit2d: 'parcial' },
    { id: 'levanta_frenar', en: ['stand up under braking', 'stands up on braking'], es: ['se levanta al frenar', 'se endereza al frenar'], pt: ['levanta ao frear', 'endireita ao frear'], it: ['si raddrizza in frenata'], firma: 'Reducción de inclinación al frenar con curva abierta', sensores: ['lean', 'brake_f'], calc: 'no', kit2d: 'no' },
    { id: 'headshake', en: ['headshake', 'wobble'], es: ['oscila el manillar', 'el manillar oscila', 'se mueve el manillar', 'latigazo del manillar', 'headshake'], pt: ['guidao balanca', 'headshake'], it: ['il manubrio sbatte', 'headshake'], firma: 'Oscilación rápida de la dirección; el kit no mide la dirección', sensores: ['roll_rate', 'yaw_rate'], calc: 'no', kit2d: 'no' },
    { id: 'freno_largo', en: ['brake fade', 'no bite'], es: ['el freno se alarga', 'sin mordiente', 'pierde mordiente'], pt: ['o freio alonga', 'sem mordida'], it: ['il freno si allunga', 'senza mordente'], firma: 'La presión necesaria para una misma deceleración sube durante la sesión', sensores: ['brake_f'], calc: 'no', kit2d: 'no' },
    { id: 'no_gira', en: ["bike won't turn", 'slow to change direction', 'reluctant to turn in'], es: ['no gira', 'pesada de cambio', 'cuesta cambiar de lado'], pt: ['nao vira', 'pesada para virar'], it: ['non gira', 'pesante nei cambi di direzione'], firma: 'Tiempo entre soltar el freno y alcanzar la inclinación máxima; con el kit básico solo hay indicios', sensores: ['lean', 'roll_rate'], calc: 'no', kit2d: 'no' },
    { id: 'seca', en: ['harsh over bumps'], es: ['seca', 'dura', 'golpea', 'esta dura', 'la moto esta dura'], pt: ['seca', 'dura'], it: ['secca', 'dura'], firma: 'Picos de velocidad de compresión en zonas de baches', sensores: ['susp_f', 'susp_r'], calc: 'no', kit2d: 'parcial' },
    { id: 'relacion', en: ['runs out of revs', 'gearing too short', 'gearing too tall'], es: ['se acaba la marcha', 'relación corta', 'relación larga', 'se queda corta de vueltas'], pt: ['acaba a marcha', 'relacao curta', 'relacao longa'], it: ['finisce la marcia', 'rapporto corto', 'rapporto lungo'], firma: 'RPM al final de las rectas y velocidad punta (contra el límite de RPM de la ficha)', sensores: ['rpm', 'v_rear'], calc: 'indicio', kit2d: 'si' },
    { id: 'motor_se_ahoga', en: ['engine hesitates', 'flat spot'], es: ['se ahoga', 'se corta', 'le falta pegada abajo'], pt: ['afoga', 'falha'], it: ['si ingolfa', 'buco di coppia'], firma: 'TPS frente a RPM y aceleración; mezcla', sensores: ['tps', 'rpm', 'lambda'], calc: 'no', kit2d: 'parcial' },
    { id: 'calienta', en: ['runs hot', 'overheating'], es: ['se calienta', 'sobrecalienta'], pt: ['esquenta', 'superaquece'], it: ['si scalda', 'surriscalda'], firma: 'Temperatura de refrigerante y su tendencia al final de la sesión', sensores: ['water_temp'], calc: 'sesion', kit2d: 'parcial' }
  ];
  // una frase solo se corrobora o contradice con evidencia de SU tema (si no, datos_insuficientes); soloFrecuencia = a menos de 100 Hz no se puede contradecir
  const VOCAB_MET = {
    delantero_empuja: /\.(vmin|susp_f_(mitad_curva_pct|media_pct|p5_pct|p95_pct)|curvas_n)$/,
    delantero_vago: /\.(susp_f_(mitad_curva_pct|media_pct|p5_pct|p95_pct)|freno_d_(rampa_med|pico_med))$/,
    fondo: /\.susp_[fr]_fondo_(n|pct)$/,
    extension_tope: /\.susp_[fr]_extension_(n|pct)$/,
    trasera_patina: /\.patinaje_(n|pct|max)$/,
    delantero_bloquea: /\.bloqueo_del_n$/,
    caballito: /\.(susp_f_extension_(n|pct)|gas_pleno_pct|marcha_\d_pct)$/,
    relacion: /\.(rpm_max|rpm_limite_pct|rpm_medio_gas_pleno|vmax)$/,
    calienta: /\.agua_(max|media|tendencia|tendencia_final)$/
  };
  VOCAB.forEach(v => { if (VOCAB_MET[v.id]) v.metricas = VOCAB_MET[v.id]; });
  ['fondo', 'extension_tope'].forEach(id => { const v = VOCAB.find(x => x.id === id); if (v) v.soloFrecuencia = true; });
  ['vibra', 'flota', 'bombea', 'fondo', 'extension_tope', 'seca'].forEach(id => { const v = VOCAB.find(x => x.id === id); if (v) v.alguno = true; }); // basta con uno de los dos sensores de suspensión
  function matchVocab(texto) {
    const t = norm(texto); if (!t) return '';
    let best = '', bl = 0;
    VOCAB.forEach(v => [].concat(v.en, v.es, v.pt || [], v.it || []).forEach(term => { const n = norm(term); if (n.length >= 5 && t.indexOf(n) >= 0 && n.length > bl) { bl = n.length; best = v.id; } }));
    return best;
  }

  /* =====================================================================
     3. Lector de CSV tolerante (separador, decimal, cabecera, unidades)
     ===================================================================== */
  function splitLine(line, d) {
    if (line.indexOf('"') < 0) return line.split(d);
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === d && !q) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur); return out;
  }
  const RE_DUR = /^\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d+))?\s*$/;
  function toNum(tok, decComma) {
    if (tok === undefined) return NaN;
    let s = String(tok).trim();
    if (s === '' || s === '-' || s === '--' || s === '---' || /^(nan|null|n\/a|na|none)$/i.test(s)) return NaN;
    if (decComma) {
      if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '');   // 12.226 o 1.234.567,5 → el punto separa miles
      if (s.indexOf(',') >= 0) s = s.replace(',', '.');
    }
    const v = Number(s);
    if (Number.isFinite(v)) return v;
    const m = RE_DUR.exec(s); // 1:45.123 o 0:01:45.123 → segundos
    if (m) { const h = m[1] ? +m[1] : 0, mi = +m[2], se = +m[3], fr = m[4] ? +('0.' + m[4]) : 0; return h * 3600 + mi * 60 + se + fr; }
    return NaN;
  }
  function numShare(tokens, decComma) {
    let c = 0, n = 0;
    for (const t of tokens) { if (String(t).trim() === '') continue; n++; if (Number.isFinite(toNum(t, decComma))) c++; }
    return n ? c / n : 0;
  }
  function detectDelimiter(lines) {
    const cands = [';', '\t', ',', '|'];
    const sample = []; for (let i = 0; i < lines.length && sample.length < 60; i++) if (lines[i].trim()) sample.push(lines[i]);
    let best = null, bestScore = -1;
    for (const d of cands) {
      const counts = sample.map(l => splitLine(l, d).length - 1);
      const freq = {}; counts.forEach(c => { freq[c] = (freq[c] || 0) + 1; });
      let mode = 0, mf = 0; for (const k in freq) if (freq[k] > mf || (freq[k] === mf && +k > mode)) { mf = freq[k]; mode = +k; }
      if (mode < 1) continue;
      const score = (mf / Math.max(1, sample.length)) * Math.min(mode, 12) + (mf / Math.max(1, sample.length));
      if (score > bestScore + 1e-9) { bestScore = score; best = d; }
    }
    if (best === ',') { // «;», tabulador o «|» con coma decimal en TODAS las columnas: la coma gana por cantidad pero el otro es el separador
      const data = sample.slice(Math.min(sample.length - 1, 5));
      for (const alt of [';', '\t', '|']) {
        const cs = sample.map(l => splitLine(l, alt).length - 1); const fq = {}; cs.forEach(c => { fq[c] = (fq[c] || 0) + 1; });
        let md = 0, mf = 0; for (const k in fq) if (fq[k] > mf) { mf = fq[k]; md = +k; }
        if (md >= 1 && mf / sample.length >= 0.8 && data.length && data.every(l => l.replace(/\d,\d/g, '').indexOf(',') < 0)) { best = alt; break; }
      }
    }
    return best || ',';
  }
  function detectDecimalComma(lines, d) {
    if (d === ',') return false;
    let seen = 0, hit = 0;
    for (let i = 0; i < lines.length && seen < 200; i++) {
      const l = lines[i]; if (!l.trim()) continue; seen++;
      const tk = splitLine(l, d);
      for (const t of tk) if (/^\s*-?\d+,\d+\s*$/.test(t)) { hit++; break; }
    }
    return hit >= Math.max(3, seen * 0.2);
  }
  function extractUnit(h) {
    const m = /^(.*?)\s*[\[(]\s*([^\])]*?)\s*[\])]\s*$/.exec(h);
    return m ? { name: m[1].trim() || h.trim(), unit: m[2].trim() } : { name: h.trim(), unit: '' };
  }
  function parseTable(text, opts) {
    opts = opts || {};
    text = String(text).replace(/^﻿/, '');
    const lines = text.split(/\r\n|\n|\r/);
    const delim = opts.delimiter || detectDelimiter(lines);
    const decComma = opts.decimal ? opts.decimal === ',' : detectDecimalComma(lines, delim);
    const warnings = [];
    let hi = -1, unitsLine = -1;
    const maxScan = Math.min(lines.length, 300);
    for (let i = 0; i < maxScan; i++) {
      if (!lines[i].trim()) continue;
      const tk = splitLine(lines[i], delim);
      if (tk.length < 3) continue;
      const filled = tk.filter(x => x.trim() !== '').length;
      if (filled < tk.length * 0.7) continue;
      if (numShare(tk, decComma) > 0.3) continue;
      let j = i + 1; while (j < lines.length && !lines[j].trim()) j++;
      if (j >= lines.length) break;
      const t2 = splitLine(lines[j], delim);
      if (Math.abs(t2.length - tk.length) > 1) continue;
      const ns2 = numShare(t2, decComma);
      if (ns2 >= 0.6) { hi = i; break; }
      if (ns2 <= 0.3) {
        let k = j + 1; while (k < lines.length && !lines[k].trim()) k++;
        if (k < lines.length) { const t3 = splitLine(lines[k], delim); if (Math.abs(t3.length - tk.length) <= 1 && numShare(t3, decComma) >= 0.6) { hi = i; unitsLine = j; break; } }
      }
    }
    let names, units, start;
    if (hi < 0) {
      const first = lines.findIndex(l => l.trim());
      const nc = first >= 0 ? splitLine(lines[first], delim).length : 0;
      names = Array.from({ length: nc }, (_, i) => 'col' + (i + 1)); units = names.map(() => '');
      start = Math.max(0, first); warnings.push('No se encontró fila de nombres de canal: las columnas se llaman col1, col2…');
    } else {
      const hdr = splitLine(lines[hi], delim).map(x => x.trim());
      names = []; units = [];
      hdr.forEach(h => { const e = extractUnit(h); names.push(e.name || h); units.push(e.unit); });
      start = hi + 1;
      if (unitsLine >= 0) {
        const ut = splitLine(lines[unitsLine], delim);
        ut.forEach((u, i) => { u = String(u).trim(); if (u && i < units.length && !units[i]) units[i] = u.replace(/^[\[(]|[\])]$/g, ''); });
        start = unitsLine + 1;
      }
    }
    const nc = names.length;
    let cand = 0; for (let i = start; i < lines.length; i++) if (lines[i].trim()) cand++;
    const cols = Array.from({ length: nc }, () => new Float64Array(cand).fill(NaN));
    let n = 0, bad = 0;
    for (let i = start; i < lines.length; i++) {
      const l = lines[i]; if (!l.trim()) continue;
      const tk = splitLine(l, delim);
      if (tk.length !== nc && !(tk.length === nc + 1 && tk[nc].trim() === '')) { bad++; continue; }
      for (let c = 0; c < nc; c++) cols[c][n] = toNum(tk[c], decComma);
      n++;
    }
    const outCols = cols.map(c => c.subarray(0, n));
    const numeric = outCols.map(c => { let f = 0; const step = Math.max(1, (n / 500) | 0); let s = 0; for (let i = 0; i < n; i += step) { s++; if (c[i] === c[i]) f++; } return s ? f / s >= 0.5 : false; });
    if (bad > 0) warnings.push(bad + ' fila(s) con número de columnas distinto se omitieron.');
    if (n < 20) warnings.push('El archivo tiene muy pocas filas de datos (' + n + ').');
    return { delimiter: delim, decimal: decComma ? ',' : '.', hasHeader: hi >= 0, headerLine: hi, preamble: hi > 0 ? lines.slice(0, hi).filter(x => x.trim()).slice(0, 12) : [], names, units, cols: outCols, numeric, n, badRows: bad, warnings };
  }

  /* =====================================================================
     4. Mapeo de canales (automático + confirmable) y conversión de unidades
     ===================================================================== */
  function suggestConv(canon, unitStr, colMax) {
    const u = strip(unitStr || '').toLowerCase().replace(/\s|°/g, '');
    const c = CANALES[canon] || {}; const cu = c.unit;
    let f = 1, o = 0, unit = unitStr || cu || '';
    if (cu === 'km/h') { if (u === 'm/s' || u === 'ms-1' || u === 'mps') { f = 3.6; unit = 'm/s'; } else if (u === 'mph') { f = 1.609344; unit = 'mph'; } else if (u === 'kn' || u === 'kt' || u === 'kts') { f = 1.852; unit = 'kn'; } else unit = 'km/h'; }
    else if (cu === 's') { if (u === 'ms') { f = 0.001; unit = 'ms'; } else if (u === 'us' || u === 'µs') { f = 1e-6; unit = 'µs'; } else unit = 's'; }
    else if (cu === 'bar') { if (u === 'kpa') { f = 0.01; unit = 'kPa'; } else if (u === 'psi') { f = 0.0689476; unit = 'psi'; } else if (u === 'mpa') { f = 10; unit = 'MPa'; } else if (u === 'mbar') { f = 0.001; unit = 'mbar'; } else unit = 'bar'; }
    else if (cu === '°C') { if (u === 'f' || u === 'degf') { f = 5 / 9; o = -32 * 5 / 9; unit = '°F'; } else if (u === 'k') { o = -273.15; unit = 'K'; } else unit = '°C'; }
    else if (cu === '%') { if (!u && isNum(colMax) && colMax <= 1.5 && colMax > 0) { f = 100; unit = 'fracción'; } else unit = '%'; }
    else if (cu === '°' || cu === '°/s') { if (u === 'rad' || u === 'rad/s') { f = 57.29578; unit = u; } else unit = unitStr || cu; }
    else if (cu === 'mm') { if (u === 'cm') { f = 10; unit = 'cm'; } else if (u === 'm') { f = 1000; unit = 'm'; } else if (u === '%') { unit = '%'; } else unit = unitStr || 'mm'; }
    else if (cu === 'm/s²') { if (u === 'g') { f = 9.80665; unit = 'g'; } else unit = 'm/s²'; }
    return { factor: f, offset: o, unit };
  }
  function colStats(col) {
    const s = finiteSorted(col, 0, Math.min(col.length, 200000));
    return { min: s.length ? s[0] : NaN, max: s.length ? s[s.length - 1] : NaN, med: pctl(s, 0.5) };
  }
  // Alias que dependen de la POSICIÓN del canal en el equipo (ANALOG1, EXT3, MULTI7, CAN5, SPD1, VEL2…): no dicen qué miden.
  const RE_POSICIONAL = /^(analog\d+|\d+analog|ext\d+|multi\d+|can\d+|spd\d+|speed\d+|vel\d+)$/;
  const TEMP_CH = { water_temp: 1, air_temp: 1 };
  const RE_UNIDAD_TEMP = /^(c|degc|f|degf|k)$/;
  function unitCompat(canon, raw, unit) {
    const u = strip(unit || '').toLowerCase().replace(/\s|°/g, '');
    const esTempUnit = RE_UNIDAD_TEMP.test(u);
    if (TEMP_CH[canon]) return !(u && !esTempUnit && /^(bar|mm|km\/h|kmh|rpm|%|v|psi|kpa|m\/s)$/.test(u));
    if (esTempUnit) return false;                    // °C/°F/K en un canal que no es temperatura
    if (/\btemp(erature|eratura)?\b/i.test(strip(raw))) return false; // «… Temp» nunca es presión, recorrido ni velocidad
    if (/\bratio\b|\brelacion\b/i.test(strip(raw))) return false;   // «Gear Ratio» no es la marcha
    return true;
  }
  function autoMap(profile, table) {
    const P = typeof profile === 'string' ? PERFILES[profile] : profile;
    const tri = [];
    table.names.forEach((nm, ci) => {
      if (!table.numeric[ci]) return;
      const nn = norm(nm);
      if (!nn) return;
      for (const canon in P.canales) {
        if (!unitCompat(canon, nm, table.units[ci])) continue;
        for (const al of P.canales[canon].aliases) {
          let sc = 0;
          if (nn === al) sc = 100;
          else if (canon === 'lat' || canon === 'lon') sc = 0; // coordenadas: solo nombre exacto (si no, «Longitudinal G» acaba siendo longitud)
          else if (al.length >= 6 && nn.startsWith(al)) sc = 70;
          else if (nn.length >= 6 && al.startsWith(nn)) sc = 70;
          else if (al.length >= 7 && nn.indexOf(al) >= 0) sc = 50;
          if (sc) tri.push({ canon, ci, sc, pos: RE_POSICIONAL.test(al) });
        }
      }
    });
    tri.sort((a, b) => b.sc - a.sc || (a.pos ? 1 : 0) - (b.pos ? 1 : 0));
    const map = {}, usedC = new Set(), usedCh = new Set();
    for (const t of tri) {
      if (usedC.has(t.ci) || usedCh.has(t.canon)) continue;
      usedC.add(t.ci); usedCh.add(t.canon);
      const st = colStats(table.cols[t.ci]);
      const cv = suggestConv(t.canon, table.units[t.ci], st.max);
      map[t.canon] = { col: t.ci, name: table.names[t.ci], conf: t.pos ? 'baja' : t.sc >= 100 ? 'alta' : t.sc >= 70 ? 'media' : 'baja', unit: cv.unit, factor: cv.factor, offset: cv.offset, invert: false };
      if (t.pos) { map[t.canon].posicional = true; map[t.canon].confirmar = true; }
    }
    // tiempo: si no hubo coincidencia, primera columna creciente
    if (!map.t) {
      for (let ci = 0; ci < table.cols.length; ci++) {
        if (!table.numeric[ci] || usedC.has(ci)) continue;
        const c = table.cols[ci]; let inc = 0, tot = 0;
        for (let i = 1; i < c.length; i += Math.max(1, (c.length / 400) | 0)) { tot++; if (c[i] > c[i - 1]) inc++; }
        if (tot > 20 && inc / tot > 0.95) { map.t = { col: ci, name: table.names[ci], conf: 'baja', unit: 's', factor: 1, offset: 0, invert: false }; usedC.add(ci); break; }
        break; // solo se prueba la primera columna numérica libre
      }
    }
    // tiempo en ms: el paso mediano es demasiado grande para segundos
    if (map.t) {
      const c = table.cols[map.t.col]; const d = [];
      for (let i = 1; i < c.length && d.length < 2000; i++) { const x = c[i] - c[i - 1]; if (x > 0) d.push(x); }
      const md = median(Float64Array.from(d));
      const u = strip(table.units[map.t.col] || '').toLowerCase();
      if (u === 'ms' || (u === '' && isNum(md) && md >= 2)) { map.t.factor = 0.001; map.t.unit = 'ms'; }
    }
    return map;
  }
  // Rango observado de cada columna enlazada (ya con su conversión) y aviso si no cuadra con lo que debería ser.
  const RANGOS = {
    tps: { min: -5, max: 140, txt: 'acelerador: se espera entre 0 y 100 %' }, rpm: { min: 0, max: 20000, txt: 'RPM: se espera menos de 20 000' },
    gps_speed: { min: -1, max: 400, txt: 'velocidad GPS: se espera menos de 400 km/h' }, v_rear: { min: -1, max: 400, txt: 'velocidad de rueda: se espera menos de 400 km/h' }, v_front: { min: -1, max: 400, txt: 'velocidad de rueda: se espera menos de 400 km/h' },
    brake_f: { min: -2, max: 250, txt: 'presión de freno: se espera menos de 250 bar' }, brake_r: { min: -2, max: 250, txt: 'presión de freno: se espera menos de 250 bar' },
    water_temp: { min: -10, max: 150, txt: 'agua: se espera entre 20 y 130 °C' }, lean: { min: -75, max: 75, txt: 'inclinación: se espera menos de 70°' }, lambda: { min: 0.3, max: 3, txt: 'lambda: se espera entre 0,6 y 1,5' }
  };
  function rangoPlausible(canon, st) {
    const r = RANGOS[canon]; if (!r || !st || !isNum(st.min) || !isNum(st.max)) return null;
    if (st.max > r.max || st.min < r.min) return 'Valores fuera de lo esperable (' + rnd(st.min, 1) + ' a ' + rnd(st.max, 1) + '): ' + r.txt + '. Revisa la columna, la unidad o el factor.';
    if (canon === 'tps' && st.max < 60) return 'El acelerador solo llega a ' + rnd(st.max, 1) + ' %: ' + r.txt + '. Revisa la columna o la calibración.';
    return null;
  }
  function mapStats(table, map, canon) {
    const out = {};
    Object.keys(map).forEach(k => {
      if (canon && k !== canon) return; const m = map[k]; if (!m || m.col == null || !table.cols[m.col]) return;
      const st = colStats(table.cols[m.col]); const f = m.factor == null ? 1 : m.factor, o = m.offset || 0;
      const a = st.min * f + o, b = st.max * f + o; const mn = Math.min(a, b), mx = Math.max(a, b);
      out[k] = { min: rnd(mn, 2), max: rnd(mx, 2), aviso: rangoPlausible(k, { min: mn, max: mx }) };
    });
    return out;
  }

  /* =====================================================================
     5. Series canónicas, vueltas y métricas
     ===================================================================== */
  function applyConv(col, m, n) {
    const out = new Float64Array(n); const f = m.factor == null ? 1 : m.factor, o = m.offset || 0;
    for (let i = 0; i < n; i++) { const v = col[i]; out[i] = (v === v) ? v * f + o : NaN; }
    return out;
  }
  function ffill(a) { let last = NaN, filled = 0, miss = 0; for (let i = 0; i < a.length; i++) { if (a[i] !== a[i]) { miss++; if (last === last) { a[i] = last; filled++; } } else last = a[i]; } return { miss, filled }; }
  function runs(a, i0, i1, pred, minLen) { // cuenta tramos consecutivos que cumplen pred con al menos minLen muestras
    let c = 0, len = 0;
    for (let i = i0; i < i1; i++) { if (pred(a[i], i)) len++; else { if (len >= minLen) c++; len = 0; } }
    if (len >= minLen) c++;
    return c;
  }

  // segundos reales entre las muestras a y b-1, sin contar saltos de unión (vueltas excluidas, paradas en boxes) ni huecos de registro
  function tspan(S, a, b) {
    const step = 1 / S.hz, cap = 3 * step; let d = 0;
    for (let i = a; i + 1 < b; i++) { const dt = S.t[i + 1] - S.t[i]; d += (dt > 0 && dt <= cap) ? dt : step; }
    return d;
  }
  const veces = n => n + (n === 1 ? ' vez' : ' veces');
  const lbl = c => (CANALES[c] ? CANALES[c].label : c);
  function pickRun(raw, n0) { // segmenta el tiempo en tramos crecientes; un retroceso persistente grande = reinicio (salidas unidas, contador que da la vuelta)
    const pos = []; for (let i = 1; i < n0 && pos.length < 4000; i++) { const d = raw[i] - raw[i - 1]; if (d > 0 && d === d) pos.push(d); }
    const dm = pos.length ? median(Float64Array.from(pos)) : NaN;
    const thr = isNum(dm) ? Math.max(dm * 50, 1) : 1;
    const runs = []; let cur = []; let last = -Infinity;
    for (let i = 0; i < n0; i++) {
      const v = raw[i]; if (!(v === v)) continue;
      if (v > last) { cur.push(i); last = v; continue; }
      if (v < last - thr) { // ¿reinicio de verdad? los siguientes valores también están por debajo
        let persist = true; for (let k = 1; k <= 4 && i + k < n0; k++) { const w = raw[i + k]; if (w === w && w > last - thr) { persist = false; break; } }
        if (persist) { runs.push(cur); cur = [i]; last = v; }
      }
    }
    runs.push(cur);
    let best = runs[0]; for (const r of runs) if (r.length > best.length) best = r;
    return { keep: best, nRuns: runs.length };
  }
  function buildSeries(table, mapping, meta) {
    meta = meta || {}; const notes = []; const note = (nivel, texto) => notes.push({ nivel, texto: String(texto).replace(/\bde el\b/g, 'del') });
    const n0 = table.n; if (!n0) return { error: 'El archivo no tiene filas de datos.' };
    // conversiones válidas y columnas repetidas
    const usedCols = {};
    for (const canon in mapping) {
      const m = mapping[canon]; if (!m || m.col == null) continue;
      const f = m.factor == null ? 1 : +m.factor;
      if (!(isFinite(f) && f > 0)) return { error: 'El factor de conversión de «' + lbl(canon) + '» debe ser un número mayor que 0 (para dar la vuelta a la suspensión usa «Invertir»).' };
      (usedCols[m.col] = usedCols[m.col] || []).push(canon);
    }
    for (const c in usedCols) if (usedCols[c].length > 1) return { error: 'La misma columna está enlazada a dos canales (' + usedCols[c].map(lbl).join(' y ') + '). Cada canal necesita su propia columna.' };
    let t0 = null;
    if (mapping.t && mapping.t.col != null) t0 = applyConv(table.cols[mapping.t.col], mapping.t, n0);
    else if (meta.hz > 0) { t0 = new Float64Array(n0); for (let i = 0; i < n0; i++) t0[i] = i / meta.hz; note('info', 'Sin columna de tiempo: se usó la frecuencia indicada (' + meta.hz + ' Hz).'); }
    else return { error: 'No hay columna de tiempo. Elige una en el mapeo o indica la frecuencia de muestreo (Hz).' };
    // se conservan solo filas con tiempo finito y estrictamente creciente (dentro del tramo más largo)
    const pr = pickRun(t0, n0); const keep = pr.keep; const dropped = n0 - keep.length;
    if (keep.length < 50) return { error: 'Quedaron menos de 50 filas con tiempo válido y creciente.' };
    if (pr.nRuns > 1) note(dropped / n0 > 0.2 ? 'alerta' : 'atencion', 'El tiempo se reinicia ' + veces(pr.nRuns - 1) + ' (varias salidas unidas o un contador de tiempo que da la vuelta). Se analiza solo el tramo más largo (' + keep.length + ' de ' + n0 + ' filas); separa las salidas en el programa de origen para analizarlas todas.');
    else if (dropped > 0) note(dropped / n0 > 0.02 ? 'atencion' : 'info', dropped + ' fila(s) con tiempo repetido o que retrocede se descartaron (' + rnd(100 * dropped / n0, 1) + ' %).');
    const n = keep.length; const S = { n, t: new Float64Array(n), has: {}, nanShare: {}, notes, nRuns: pr.nRuns, filasDescartadas: dropped };
    const base = t0[keep[0]]; for (let i = 0; i < n; i++) S.t[i] = t0[keep[i]] - base;
    const dts = new Float64Array(n - 1); for (let i = 1; i < n; i++) dts[i - 1] = S.t[i] - S.t[i - 1];
    const mdt = median(dts); S.hz = mdt > 0 ? 1 / mdt : NaN; S.dtMed = mdt;
    let gaps = 0; for (let i = 0; i < dts.length; i++) if (dts[i] > mdt * 5) gaps++;
    S.gaps = gaps; S.dur = S.t[n - 1];
    S.rangos = {};
    for (const canon in mapping) {
      if (canon === 't') continue; const m = mapping[canon]; if (!m || m.col == null) continue;
      const full = applyConv(table.cols[m.col], m, n0); const a = new Float64Array(n);
      for (let i = 0; i < n; i++) a[i] = full[keep[i]];
      if (canon === 'lap') { S.lap = a; continue; }
      const f = ffill(a); S.nanShare[canon] = f.miss / n;
      let fin = 0; for (let i = 0; i < n; i += Math.max(1, (n / 2000) | 0)) if (a[i] === a[i]) fin++;
      if (fin / Math.min(n, 2000) < 0.5) { note('atencion', 'El canal «' + lbl(canon) + '» casi no tiene datos y se ignoró.'); continue; }
      const sorted = finiteSorted(a, 0, n); const st = { min: sorted[0], max: sorted[sorted.length - 1] }; S.rangos[canon] = st;
      if ((canon === 'lat' && (st.max > 90 || st.min < -90)) || (canon === 'lon' && (st.max > 180 || st.min < -180))) { note('atencion', 'Las coordenadas GPS (' + lbl(canon) + ') no están en grados decimales (¿formato ddmm.mmmm?): no se usan para cortar vueltas.'); continue; }
      const rp = rangoPlausible(canon, st); if (rp) note('atencion', '«' + lbl(canon) + '»: ' + rp);
      if (/^(rpm|brake_f|brake_r|gps_speed|v_rear|v_front)$/.test(canon)) { const p999 = pctl(sorted, 0.999); if (st.max > 1.5 * p999 && st.max - p999 > 5) note('atencion', '«' + lbl(canon) + '» tiene un pico aislado (' + rnd(st.max, 0) + ' frente a ' + rnd(p999, 0) + ' en el 99,9 % de las muestras): puede ser un dato roto que distorsiona los máximos.'); }
      S[canon] = a; S.has[canon] = true;
    }
    // velocidad de referencia: el primer canal que tenga datos reales (un GPS a 0 constante no vale)
    S.spd = null; S.spdSrc = null;
    for (const k of ['gps_speed', 'v_rear', 'v_front']) if (S[k]) { if (maxOf(S[k], 0, n) > 1) { S.spd = S[k]; S.spdSrc = k; break; } note('atencion', 'El canal «' + lbl(k) + '» está en cero (o casi) durante toda la sesión: no se usa como velocidad.'); }
    // velocidad para temporizar curvas y gas: la rueda (rápida y sin retardo) antes que el GPS
    S.spdDyn = null; S.spdDynSrc = null;
    for (const k of ['v_front', 'v_rear', 'gps_speed']) if (S[k] && maxOf(S[k], 0, n) > 1) { S.spdDyn = S[k]; S.spdDynSrc = k; break; }
    // suspensiones → unidades de recorrido
    for (const ax of ['f', 'r']) {
      const k = 'susp_' + ax; if (!S[k]) continue;
      const m = mapping[k]; const travel = ax === 'f' ? +meta.travelF : +meta.travelR; const nom = ax === 'f' ? 'la horquilla' : 'el amortiguador';
      const info = { unit: 'mm', travel: null, rel: false, rangoDudoso: false, modo: 'mm' };
      const a = S[k];
      const calFalta = m.mode === 'cal' && !(isNum(+m.raw0) && isNum(+m.raw1) && +m.raw1 !== +m.raw0);
      if (calFalta) { info.rangoDudoso = true; info.calFalta = true; note('alerta', 'Elegiste calibrar el sensor de ' + nom + ' pero faltan los dos valores (extensión total y compresión total) o son iguales. Se bloquean el fondo y la extensión.'); }
      if (travel > 0 && (travel < 20 || travel > 400)) note('atencion', 'Recorrido de ' + nom + ' indicado: ' + travel + ' mm. Es un valor poco habitual (se espera entre 20 y 400 mm): revísalo.');
      if (m.mode === 'cal' && isNum(+m.raw0) && isNum(+m.raw1) && +m.raw1 !== +m.raw0 && travel > 0) {
        // calibración propia: raw0 = extensión total, raw1 = compresión total (en la unidad ya convertida del canal); la calibración manda sobre «invertir»
        const r0 = +m.raw0, r1 = +m.raw1; for (let i = 0; i < n; i++) a[i] = (a[i] - r0) / (r1 - r0) * travel;
        info.travel = travel; info.modo = 'cal';
      } else if (/^%/.test(m.unit || '') || m.mode === 'pct') {
        info.unit = '%'; info.travel = 100; info.modo = 'pct';
        if (m.invert) for (let i = 0; i < n; i++) a[i] = 100 - a[i];
        if (travel > 0) info.mmPorPct = travel / 100;
      } else if (travel > 0) {
        info.travel = travel; info.modo = 'mm';
        if (m.invert) for (let i = 0; i < n; i++) a[i] = travel - a[i];
      } else {
        if (m.invert) for (let i = 0; i < n; i++) a[i] = -a[i];
        const sr = finiteSorted(a, 0, n); const lo = pctl(sr, 0.001); info.travel = pctl(sr, 0.999) - lo; info.rel = true; info.modo = 'rel'; for (let i = 0; i < n; i++) a[i] -= lo;
        note('atencion', 'Sin recorrido físico de ' + nom + ': no se calcula fondo de carrera real, solo valores relativos.');
      }
      // verificación de cordura: el recorrido indicado y el cero del sensor tienen que cuadrar con lo que se midió
      if (!info.rel && info.travel > 0) {
        const sr = finiteSorted(a, 0, n); const lo = 100 * pctl(sr, 0.001) / info.travel, hi = 100 * pctl(sr, 0.999) / info.travel;
        info.p001 = rnd(lo, 1); info.p999 = rnd(hi, 1);
        info.mmAlcanzado = rnd(hi * info.travel / 100, 0);
        if (!info.calFalta) note('info', 'Rango del sensor de ' + nom + ': se movió entre el ' + rnd(lo, 0) + ' % y el ' + rnd(hi, 0) + ' % del recorrido indicado (' + info.travel + ' ' + (info.unit === '%' ? '%' : 'mm') + '). Si nunca llega cerca del 100 % y sabes que sí topó, el recorrido está tecleado de más o el cero del sensor está corrido.');
        if (lo < -5 || hi > 110) { info.rangoDudoso = true; note('alerta', 'El recorrido o el cero del sensor de ' + nom + ' NO cuadran con lo que declaras (el sensor llega a ' + rnd(lo, 0) + ' % – ' + rnd(hi, 0) + ' % del recorrido indicado). Se bloquean el fondo y la extensión. Revisa el recorrido físico, «Invertir» o la calibración.'); }
        else if (hi < 40 && !info.calFalta) { info.rangoDudoso = true; note('alerta', 'El sensor de ' + nom + ' solo recorre el ' + rnd(hi, 0) + ' % del recorrido indicado: ¿recorrido tecleado de más (por ejemplo un cero de más) o sensor sin calibrar? Se bloquean el fondo y la extensión.'); }
      }
      S['info_' + k] = info;
    }
    return S;
  }

  /* --- vueltas --- */
  function projectXY(S) {
    const lat = S.lat, lon = S.lon; const n = S.n; let la0 = 0, lo0 = 0, c = 0;
    for (let i = 0; i < n; i += Math.max(1, (n / 500) | 0)) { if (isNum(lat[i]) && isNum(lon[i]) && (lat[i] !== 0 || lon[i] !== 0)) { la0 += lat[i]; lo0 += lon[i]; c++; } }
    if (!c) return null; la0 /= c; lo0 /= c;
    const x = new Float64Array(n), y = new Float64Array(n), k = Math.cos(la0 * Math.PI / 180) * 111320;
    for (let i = 0; i < n; i++) { x[i] = (lon[i] - lo0) * k; y[i] = (lat[i] - la0) * 110540; }
    return { x, y };
  }
  function segmentLaps(S, opts) {
    opts = opts || {}; const notes = []; let laps = [], method = 'ninguno';
    const n = S.n;
    let usarColumna = !!S.lap;
    if (usarColumna) { // la columna de vuelta se valida antes de fiarse de ella
      const L = S.lap; let nf = 0, ni = 0, dec = 0, prev = NaN; const dist = new Set();
      for (let i = 0; i < n; i++) { const v = L[i]; if (v === v) { nf++; if (Math.abs(v - Math.round(v)) < 1e-6) ni++; if (dist.size <= 400) dist.add(v); if (prev === prev && v < prev) dec++; prev = v; } }
      const vac = 1 - nf / n; let rechazo = null;
      if (nf < n * 0.5) rechazo = 'está casi vacía';
      else if (ni < nf * 0.95) rechazo = 'tiene valores con decimales (parece un tiempo o una magnitud, no un contador)';
      else if (dist.size > 200) rechazo = 'tiene más de 200 valores distintos';
      else if (dec > 2) rechazo = 'no crece de forma ordenada (baja ' + dec + ' veces)';
      else if (dist.size > 1 && S.t[n - 1] / dist.size < 10) rechazo = 'daría vueltas de menos de 10 s de media';
      if (rechazo) { usarColumna = false; notes.push({ nivel: 'atencion', texto: 'La columna de vuelta elegida no parece un contador de vueltas: ' + rechazo + '. No se usa.' }); }
      else if (vac > 0.02) notes.push({ nivel: 'atencion', texto: 'La columna de vuelta tiene ' + rnd(100 * vac, 1) + ' % de celdas vacías: revisa el archivo de origen.' });
    }
    if (usarColumna) {
      const L = S.lap; let start = 0; let cur = NaN; for (let k = 0; k < n; k++) if (L[k] === L[k]) { cur = L[k]; break; }
      for (let i = 1; i <= n; i++) {
        if (i === n || (L[i] === L[i] && cur === cur && L[i] !== cur)) {
          laps.push({ num: laps.length + 1, marca: cur, i0: start, i1: i, t0: S.t[start], t1: S.t[Math.min(i, n - 1)] });
          start = i; cur = i < n ? L[i] : cur;
        }
      }
      method = 'columna de vuelta';
      if (laps.length >= 1) { laps[0].parcial = true; laps[laps.length - 1].parcial = true; }
    } else if (S.lat && S.lon && S.spd) {
      const P = projectXY(S);
      if (P) {
        // posiciones únicas (el GPS se repite entre actualizaciones)
        const U = []; let px = NaN, py = NaN;
        for (let i = 0; i < n; i++) { if (!(S.lat[i] !== 0 || S.lon[i] !== 0) || !isNum(P.x[i]) || !isNum(P.y[i])) continue; if (U.length === 0 || P.x[i] !== px || P.y[i] !== py) { U.push(i); px = P.x[i]; py = P.y[i]; } }
        const sm = movAvg(S.spd, Math.max(1, Math.round(1.0 * S.hz)));
        let im = 0, mv = -Infinity; for (let i = 0; i < n; i++) if (sm[i] > mv) { mv = sm[i]; im = i; }
        const gx = P.x[im], gy = P.y[im];
        // rumbo en el punto: entre la actualización GPS anterior y la siguiente
        let ui = 0; for (let k = 0; k < U.length; k++) if (U[k] >= im) { ui = k; break; }
        const a0 = U[Math.max(0, ui - 2)], a1 = U[Math.min(U.length - 1, ui + 2)];
        let hx = P.x[a1] - P.x[a0], hy = P.y[a1] - P.y[a0]; const hn = Math.hypot(hx, hy);
        if (hn > 0.5) {
          hx /= hn; hy /= hn; const nx = -hy, ny = hx; const W = opts.gateHalfWidth || 40; const minGap = opts.minLap || 20;
          const cross = [];
          for (let k = 0; k + 1 < U.length; k++) {
            const a = U[k], b = U[k + 1];
            if (Math.hypot(P.x[b] - P.x[a], P.y[b] - P.y[a]) > 120) continue; // salto de GPS: no es un cruce
            const da = (P.x[a] - gx) * hx + (P.y[a] - gy) * hy, db = (P.x[b] - gx) * hx + (P.y[b] - gy) * hy;
            if (da < 0 && db >= 0) {
              const fr = -da / (db - da); const lx = (P.x[a] + fr * (P.x[b] - P.x[a]) - gx) * nx + (P.y[a] + fr * (P.y[b] - P.y[a]) - gy) * ny;
              if (Math.abs(lx) <= W) {
                const tc = S.t[a] + fr * (S.t[b] - S.t[a]);
                if (!cross.length || tc - cross[cross.length - 1].t >= minGap) cross.push({ t: tc, i: b });
              }
            }
          }
          if (cross.length >= 2) {
            for (let k = 0; k + 1 < cross.length; k++) laps.push({ num: k + 1, i0: cross[k].i, i1: cross[k + 1].i, t0: cross[k].t, t1: cross[k + 1].t });
            method = 'puerta GPS automática';
            notes.push({ nivel: 'info', texto: 'Las vueltas se cortan con una puerta automática en el punto de mayor velocidad (final de recta). Los tiempos sirven para comparar vueltas entre sí; no coinciden con el cronometraje oficial.' });
            laps.__salida = cross[0].i; laps.__entrada = cross[cross.length - 1].i;
          }
        }
      }
    }
    if (!laps.length) { laps = [{ num: 1, i0: 0, i1: n, t0: S.t[0], t1: S.t[n - 1], sinVueltas: true }]; method = 'sesión completa'; notes.push({ nivel: 'atencion', texto: 'No se pudieron separar vueltas (sin columna de vuelta ni GPS utilizable): las métricas son de toda la sesión y esta sesión no entra en la comparación de mejores vueltas.' }); }
    laps.forEach(l => { l.tiempo = l.t1 - l.t0; });
    // validez: ni vueltas de entrada/salida ni interrumpidas
    const full = laps.filter(l => !l.parcial && !l.sinVueltas);
    const med = full.length ? median(Float64Array.from(full.map(l => l.tiempo))) : NaN;
    laps.forEach(l => {
      l.valida = true;
      if (l.sinVueltas) return;
      if (l.parcial) { l.valida = false; l.motivo = 'vuelta parcial (salida o entrada)'; return; }
      if (isNum(med) && (l.tiempo < med * 0.9 || l.tiempo > med * 1.15)) { l.valida = false; l.motivo = l.tiempo > med ? 'más de 15 % más lenta que la mediana (entrada, salida o incidente)' : 'más de 10 % más corta que la mediana'; }
    });
    if (method !== 'sesión completa' && !laps.some(l => l.valida)) { laps.forEach(l => { l.valida = true; l.motivo = null; }); notes.push({ nivel: 'atencion', texto: 'Ninguna vuelta pasó el filtro de validez: se usaron todas.' }); }
    // decisión manual de Antonio: manda sobre el filtro automático
    const ov = opts.override || {};
    if (method !== 'sesión completa') laps.forEach(l => { if (ov[l.num] === true) { l.valida = true; l.motivo = null; l.manual = 'incluida por ti'; } else if (ov[l.num] === false) { l.valida = false; l.motivo = 'excluida por ti'; l.manual = 'excluida por ti'; } });
    return { laps, method, notes, mediana: med };
  }

  /* --- curvas (ápices) --- */
  function findApexes(S, i0, i1) {
    const sd = S.spdDyn || S.spd; if (!sd) return [];
    const hz = S.hz, sm = movAvg(sd, Math.max(1, Math.round(0.6 * hz)));
    const w = Math.max(2, Math.round(1.5 * hz)), far = Math.round(8 * hz), prom = 12; const out = [];
    for (let i = Math.max(i0, w); i < Math.min(i1, S.n - w); i++) {
      const v = sm[i]; if (!(v === v)) continue;
      let isMin = true; for (let k = i - w; k <= i + w; k++) { if (sm[k] < v) { isMin = false; break; } }
      if (!isMin) continue;
      let lm = -Infinity, rm = -Infinity;
      for (let k = Math.max(0, i - far); k < i; k++) if (sm[k] > lm) lm = sm[k];
      for (let k = i + 1; k < Math.min(S.n, i + far); k++) if (sm[k] > rm) rm = sm[k];
      if (lm - v >= prom && rm - v >= prom) { if (!out.length || i - out[out.length - 1] > w) out.push(i); }
    }
    return out;
  }

  /* --- marcha estimada --- */
  // Se agrupan las relaciones RPM/velocidad (cada marcha es un grupo). Solo se numeran las marchas si salen EXACTAMENTE
  // las que tiene la moto: si falta una (p. ej. la 1ª nunca pasa de 25 km/h) no se sabe cuál falta y numerar sería inventar.
  function estimateGears(S, ranges, esperadas) {
    if (!S.rpm || !(S.v_rear || S.gps_speed)) return null;
    const sp = S.v_rear || S.gps_speed; const logs = []; let lo = Infinity, hi = -Infinity;
    for (const [a, b] of ranges) for (let i = a; i < b; i += 2) { const v = sp[i], r = S.rpm[i]; if (v > 25 && r > 3000) { const x = Math.log(r / v); logs.push(x); if (x < lo) lo = x; if (x > hi) hi = x; } }
    if (logs.length < 300) return null;
    const bw = 0.01, pad = 6, minL = Math.floor(lo / bw) * bw - pad * bw, nb = Math.min(500, Math.ceil((hi - minL) / bw) + pad + 2);
    const h = new Float64Array(nb); for (const x of logs) { const b = Math.floor((x - minL) / bw); if (b >= 0 && b < nb) h[b]++; }
    const hs = movAvg(h, 3); const thr = logs.length * 0.012; const peaks = [];
    for (let b = 2; b < nb - 2; b++) { if (hs[b] >= thr && hs[b] >= hs[b - 1] && hs[b] >= hs[b + 1] && hs[b] >= hs[b - 2] && hs[b] >= hs[b + 2]) { if (!peaks.length || b - peaks[peaks.length - 1] > 3) peaks.push(b); } }
    const centers = peaks.map(b => Math.exp(minL + (b + 0.5) * bw)).sort((x, y) => y - x); // más relación = marcha más corta (1ª)
    if (peaks.length < 2) return { ok: false, peaks: peaks.length, esperadas, centers };
    if (esperadas && peaks.length !== esperadas) return { ok: false, peaks: peaks.length, esperadas, centers };
    for (let k = 1; k < centers.length; k++) { const st = centers[k - 1] / centers[k]; if (st < 1.07 || st > 1.75) return { ok: false, peaks: peaks.length, esperadas, centers, motivo: 'saltos entre marchas poco creíbles' }; }
    return { ok: true, centers, peaks: peaks.length, esperadas, calidad: 'media' };
  }
  function assignGear(S, G) {
    const sp = S.v_rear || S.gps_speed; const out = new Uint8Array(S.n);
    for (let i = 0; i < S.n; i++) {
      const v = sp[i], r = S.rpm[i]; if (!(v > 25 && r > 3000)) continue;
      const q = r / v; let bi = -1, bd = 0.04;
      for (let k = 0; k < G.centers.length; k++) { const d = Math.abs(Math.log(q / G.centers[k])); if (d < bd) { bd = d; bi = k; } }
      out[i] = bi + 1;
    }
    return out;
  }

  /* --- métricas por rango --- */
  const PARAM = { gasPleno: 95, fondoPct: 98, extPct: 2, slipPct: 5, frenoMin: 3, frenoFrac: 0.1 };
  function suspMetrics(S, ax, i0, i1, apexes, out, pre, P) {
    const k = 'susp_' + ax, a = S[k]; if (!a) return;
    const info = S['info_' + k], T = info.travel, pcts = new Float64Array(i1 - i0);
    for (let i = i0; i < i1; i++) pcts[i - i0] = a[i] === a[i] ? 100 * a[i] / T : NaN;
    const sorted = finiteSorted(pcts, 0, pcts.length); if (!sorted.length) return;
    out[pre + 'media_pct'] = mean(pcts, 0, pcts.length);
    out[pre + 'p5_pct'] = pctl(sorted, 0.05); out[pre + 'p95_pct'] = pctl(sorted, 0.95);
    if (!info.rel && !info.rangoDudoso) {
      const lim = P.fondoPct, ext = P.extPct; let nb = 0, ne = 0;
      for (const v of sorted) { if (v >= lim) nb++; if (v <= ext) ne++; }
      const minLen = Math.max(1, Math.round(0.01 * S.hz)); // duración mínima ≈10 ms (a baja frecuencia un toque corto cae en 1 sola muestra: se cuenta igual; puede haber más sin ver)
      out[pre + 'fondo_pct'] = 100 * nb / sorted.length; out[pre + 'extension_pct'] = 100 * ne / sorted.length;
      out[pre + 'fondo_n'] = runs(pcts, 0, pcts.length, v => v >= lim, minLen);
      out[pre + 'extension_n'] = runs(pcts, 0, pcts.length, v => v <= ext, minLen);
    }
    // posición a mitad de curva (±0.15 s del ápice)
    const hw = Math.max(1, Math.round(0.15 * S.hz)); const mc = [];
    for (const ia of apexes) { if (ia < i0 || ia >= i1) continue; let s = 0, c = 0; for (let i = Math.max(i0, ia - hw); i <= Math.min(i1 - 1, ia + hw); i++) if (a[i] === a[i]) { s += 100 * a[i] / T; c++; } if (c) mc.push(s / c); }
    if (mc.length >= 2) out[pre + 'mitad_curva_pct'] = mc.reduce((x, y) => x + y, 0) / mc.length;
    // velocidad de amortiguador: ventana fija de ~40 ms, solo con muestreo de 100 Hz o más y con recorrido en mm (a menos Hz la cifra depende de la frecuencia)
    const mmPer = info.unit === '%' ? (info.mmPorPct || 0) : 1;
    if (S.hz >= 99.5 && !info.rel && !info.rangoDudoso && mmPer > 0) {
      const h = Math.max(1, Math.round(0.02 * S.hz)), comp = [], reb = [];
      for (let i = Math.max(i0, h); i < Math.min(i1, S.n - h); i++) {
        const dt = S.t[i + h] - S.t[i - h]; if (!(dt > 0)) continue; const v = (a[i + h] - a[i - h]) / dt * mmPer;
        if (v === v) { if (v >= 10) comp.push(v); else if (v <= -10) reb.push(-v); } // solo en movimiento (≥10 mm/s)
      }
      comp.sort((x, y) => x - y); reb.sort((x, y) => x - y);
      if (comp.length > 20) out[pre + 'vel_comp_p95'] = pctl(comp, 0.95);
      if (reb.length > 20) out[pre + 'vel_ext_p95'] = pctl(reb, 0.95);
    }
  }
  function brakeZones(S, i0, i1, key, P, refMax) {
    const a = S[key]; if (!a) return null;
    const on = Math.max(P.frenoMin, P.frenoFrac * refMax), off = on * 0.5; const minS = Math.max(1, Math.round(0.2 * S.hz));
    const zones = []; let inz = false, s = 0, pk = 0, ipk = 0;
    for (let i = i0; i < i1; i++) {
      const v = a[i]; if (!inz) { if (v >= on) { inz = true; s = i; pk = v; ipk = i; } }
      else { if (v > pk) { pk = v; ipk = i; } if (v < off || i === i1 - 1) { if (i - s >= minS) { const dt = S.t[ipk] - S.t[s]; zones.push({ i0: s, i1: i, pico: pk, rampa: dt > 0 ? (pk - on) / dt : NaN, dur: tspan(S, s, i) }); } inz = false; } }
    }
    return zones;
  }
  function rangeMetrics(S, i0, i1, ctx) {
    const o = {}, P = ctx.P, n = i1 - i0; if (n < 5) return o;
    const dur = tspan(S, i0, i1);
    if (S.spd) {
      o.vmax = maxOf(S.spd, i0, i1);
      const sorted = finiteSorted(S.spd, i0, i1); o.vmin = pctl(sorted, 0.01); o.vmedia = mean(S.spd, i0, i1);
    }
    if (S.tps) {
      let c = 0, tot = 0; for (let i = i0; i < i1; i++) { const v = S.tps[i]; if (v === v) { tot++; if (v >= P.gasPleno) c++; } }
      o.gas_pleno_pct = tot ? 100 * c / tot : NaN; o.gas_medio = mean(S.tps, i0, i1);
    }
    const apex = ctx.noApex ? [] : findApexes(S, i0, i1);
    if (apex.length) o.curvas_n = apex.length;
    if (S.tps && apex.length) {
      const d = []; for (const ia of apex) { for (let i = ia; i < Math.min(i1, ia + Math.round(6 * S.hz)); i++) if (S.tps[i] >= P.gasPleno) { d.push(S.t[i] - S.t[ia]); break; } }
      if (d.length >= 2) { d.sort((x, y) => x - y); o.apice_a_gas_pleno_s = pctl(d, 0.5); }
    }
    // frenos
    for (const [key, pre] of [['brake_f', 'freno_d_'], ['brake_r', 'freno_t_']]) {
      if (!S[key]) continue;
      const z = brakeZones(S, i0, i1, key, P, ctx.brakeRef[key]);
      o[pre + 'pmax'] = maxOf(S[key], i0, i1);
      if (z) {
        o[pre + 'zonas'] = z.length;
        if (z.length) { const pk = z.map(q => q.pico).sort((x, y) => x - y); o[pre + 'pico_med'] = pctl(pk, 0.5); const rp = z.map(q => q.rampa).filter(isNum).sort((x, y) => x - y); if (rp.length) o[pre + 'rampa_med'] = pctl(rp, 0.5); let tb = 0; z.forEach(q => { tb += q.dur; }); o[pre + 'tiempo_pct'] = 100 * tb / Math.max(dur, 1e-9); }
      }
    }
    // bloqueo delantero (indicio): rueda delantera mucho más lenta que la referencia con freno aplicado
    if (S.v_front && S.brake_f) {
      const ref = S.v_rear || S.gps_speed; if (ref) {
        const zs = brakeZones(S, i0, i1, 'brake_f', P, ctx.brakeRef.brake_f) || []; let ev = 0;
        const minB = Math.max(1, Math.round(0.1 * S.hz)); const vf = S.v_front;
        // una caída de >40 km/h a 0,0 exacto en una sola muestra es pérdida de señal del sensor, no un bloqueo (la rueda no frena de golpe)
        const perdida = i => i > 0 && vf[i] === 0 && vf[i - 1] > 40;
        zs.forEach(z => { let len = 0, drop = false; for (let i = z.i0; i <= z.i1; i++) { const m = i < z.i1 && ref[i] > 40 && vf[i] < 0.85 * ref[i]; if (m) { if (len === 0) drop = perdida(i); len++; } else { if (len >= minB && !drop) ev++; len = 0; drop = false; } } });
        o.bloqueo_del_n = ev;
      }
    }
    // patinaje relativo trasero
    if (S.v_rear && S.v_front && S.tps && ctx.slipBase) { // solo con rueda delantera: el GPS va retrasado y fabrica «patinaje»
      const ref = S.v_front, b = ctx.slipBase; const sl = []; const sa = new Float64Array(i1 - i0).fill(NaN);
      for (let i = i0; i < i1; i++) { if (S.tps[i] >= 30 && ref[i] > 40) { const q = (S.v_rear[i] / ref[i] / b - 1) * 100; sl.push(q); sa[i - i0] = q; } }
      if (sl.length > 20) {
        const sms = movAvg(sa, Math.max(1, Math.round(0.2 * S.hz))); let pm = -Infinity; for (let i = 0; i < sa.length; i++) if (sa[i] === sa[i] && sms[i] > pm) pm = sms[i];
        o.patinaje_max = pm; let c = 0; for (const v of sl) if (v > P.slipPct) c++; o.patinaje_pct = 100 * c / sl.length;
        o.patinaje_n = runs(S.v_rear, i0, i1, (v, i) => S.tps[i] >= 30 && ref[i] > 40 && (v / ref[i] / b - 1) * 100 > P.slipPct, Math.max(1, Math.round(0.1 * S.hz)));
      }
    }
    // motor
    if (S.rpm) {
      o.rpm_max = maxOf(S.rpm, i0, i1);
      if (isNum(ctx.rpmLimit)) { let c = 0, tot = 0; for (let i = i0; i < i1; i++) { const v = S.rpm[i]; if (v === v) { tot++; if (v >= ctx.rpmLimit * 0.98) c++; } } o.rpm_limite_pct = tot ? 100 * c / tot : NaN; }
      if (S.tps) { let s = 0, c = 0; for (let i = i0; i < i1; i++) if (S.tps[i] >= P.gasPleno && S.rpm[i] === S.rpm[i]) { s += S.rpm[i]; c++; } if (c) o.rpm_medio_gas_pleno = s / c; }
    }
    if (S.gearEst && !S.gear) { const tt = [0, 0, 0, 0, 0, 0, 0]; let tot = 0; for (let i = i0; i < i1; i++) { const g = S.gearEst[i]; if (g > 0) { tt[Math.min(g, 6)]++; tot++; } } if (tot) for (let g = 1; g <= 6; g++) o['marcha_' + g + '_pct'] = 100 * tt[g] / tot; }
    if (S.gear) { const tt = new Array(8).fill(0); let tot = 0; for (let i = i0; i < i1; i++) { const g = Math.round(S.gear[i]); if (g >= 1 && g <= 7) { tt[g]++; tot++; } } if (tot) for (let g = 1; g <= 7; g++) if (g <= 6 || tt[g] > 0) o['marcha_' + g + '_pct'] = 100 * tt[g] / tot; }
    if (S.water_temp) { o.agua_max = maxOf(S.water_temp, i0, i1); o.agua_media = mean(S.water_temp, i0, i1); }
    if (S.lambda && S.tps) { let s = 0, c = 0; for (let i = i0; i < i1; i++) if (S.tps[i] >= 80 && S.lambda[i] === S.lambda[i]) { s += S.lambda[i]; c++; } if (c > 10) o.lambda_gas_alto = s / c; }
    // Ducati / CAN
    if (S.lean) { const abs = new Float64Array(n); for (let i = i0; i < i1; i++) abs[i - i0] = Math.abs(S.lean[i]); const s = finiteSorted(abs, 0, n); o.lean_max = pctl(s, 0.999); o.lean_p95 = pctl(s, 0.95); }
    if (S.pitch) { const s = finiteSorted(S.pitch, i0, i1); o.pitch_p5 = pctl(s, 0.05); o.pitch_p95 = pctl(s, 0.95); }
    for (const [k, nm] of [['tq_slow', 'par_lento'], ['tq_fast', 'par_rapido']]) if (S[k]) { let c = 0, tot = 0; for (let i = i0; i < i1; i++) { const v = S[k][i]; if (v === v) { tot++; if (v > 0.5) c++; } } o[nm + '_pct'] = tot ? 100 * c / tot : NaN; o[nm + '_n'] = runs(S[k], i0, i1, v => v > 0.5, Math.max(1, Math.round(0.05 * S.hz))); }
    if (S.clutch) { let c = 0, tot = 0; const hiv = ctx.clutchHigh; for (let i = i0; i < i1; i++) { const v = S.clutch[i]; if (v === v) { tot++; if (v >= hiv) c++; } } if (tot && ctx.clutchBinary) o.embrague_pct = 100 * c / tot; }
    if (S.acc_x) { const s = finiteSorted(S.acc_x, i0, i1); o.accx_p5 = pctl(s, 0.05); o.accx_p95 = pctl(s, 0.95); }
    if (S.acc_y) { const s = finiteSorted(S.acc_y, i0, i1); o.accy_p5 = pctl(s, 0.05); o.accy_p95 = pctl(s, 0.95); }
    suspMetrics(S, 'f', i0, i1, apex, o, 'susp_f_', P);
    suspMetrics(S, 'r', i0, i1, apex, o, 'susp_r_', P);
    return o;
  }

  /* --- definiciones de métricas (etiquetas, unidades, qué canal exigen) --- */
  const MDEF = {
    tiempo: { l: 'Tiempo de vuelta', u: 's', d: 3, g: 'Tiempos', req: ['t'] },
    vmax: { l: 'Velocidad máxima', u: 'km/h', d: 1, g: 'Tiempos', req: ['spd'] },
    vmin: { l: 'Velocidad mínima (percentil 1)', u: 'km/h', d: 1, g: 'Tiempos', req: ['spd'] },
    vmedia: { l: 'Velocidad media', u: 'km/h', d: 1, g: 'Tiempos', req: ['spd'] },
    curvas_n: { l: 'Curvas detectadas', u: '', d: 0, g: 'Tiempos', req: ['spd'] },
    gas_pleno_pct: { l: 'Tiempo a gas pleno (≥95 % del máximo del acelerador)', u: '%', d: 1, g: 'Gas', req: ['tps'] },
    gas_medio: { l: 'Apertura media de gas', u: '%', d: 1, g: 'Gas', req: ['tps'] },
    apice_a_gas_pleno_s: { l: 'Del punto más lento de la curva a gas pleno (mediana)', u: 's', d: 2, g: 'Gas', req: ['tps', 'spd'] },
    freno_d_pmax: { l: 'Presión máx. freno delantero', u: 'bar', d: 1, g: 'Freno', req: ['brake_f'] },
    freno_d_zonas: { l: 'Frenadas (delantero)', u: '', d: 0, g: 'Freno', req: ['brake_f'] },
    freno_d_pico_med: { l: 'Pico de presión típico (delantero)', u: 'bar', d: 1, g: 'Freno', req: ['brake_f'] },
    freno_d_rampa_med: { l: 'Velocidad de aplicación del freno (delantero)', u: 'bar/s', d: 0, g: 'Freno', req: ['brake_f'] },
    freno_d_tiempo_pct: { l: 'Tiempo frenando (delantero)', u: '%', d: 1, g: 'Freno', req: ['brake_f'] },
    freno_t_pmax: { l: 'Presión máx. freno trasero', u: 'bar', d: 1, g: 'Freno', req: ['brake_r'] },
    freno_t_zonas: { l: 'Frenadas (trasero)', u: '', d: 0, g: 'Freno', req: ['brake_r'] },
    freno_t_pico_med: { l: 'Pico de presión típico (trasero)', u: 'bar', d: 1, g: 'Freno', req: ['brake_r'] },
    freno_t_rampa_med: { l: 'Velocidad de aplicación del freno (trasero)', u: 'bar/s', d: 0, g: 'Freno', req: ['brake_r'] },
    freno_t_tiempo_pct: { l: 'Tiempo frenando (trasero)', u: '%', d: 1, g: 'Freno', req: ['brake_r'] },
    bloqueo_del_n: { l: 'Indicios de bloqueo del delantero', u: '', d: 0, g: 'Freno', req: ['v_front', 'brake_f', 'gps_speed'] },
    patinaje_max: { l: 'Patinaje trasero relativo máximo (media de 0,2 s)', u: '%', d: 1, g: 'Ruedas', req: ['v_rear', 'v_front', 'tps'] },
    patinaje_pct: { l: 'Tiempo con patinaje relativo >5 %', u: '%', d: 1, g: 'Ruedas', req: ['v_rear', 'v_front', 'tps'] },
    patinaje_n: { l: 'Eventos de patinaje relativo >5 %', u: '', d: 0, g: 'Ruedas', req: ['v_rear', 'v_front', 'tps'] },
    rpm_max: { l: 'RPM máximas', u: 'rpm', d: 0, g: 'Motor', req: ['rpm'] },
    rpm_limite_pct: { l: 'Tiempo a menos del 2 % del límite de RPM indicado en la ficha', u: '%', d: 2, g: 'Motor', req: ['rpm', 'rpmLimit'] },
    rpm_medio_gas_pleno: { l: 'RPM medias a gas pleno', u: 'rpm', d: 0, g: 'Motor', req: ['rpm', 'tps'] },
    agua_max: { l: 'Temperatura de agua máxima', u: '°C', d: 1, g: 'Motor', req: ['water_temp'] },
    agua_media: { l: 'Temperatura de agua media', u: '°C', d: 1, g: 'Motor', req: ['water_temp'] },
    lambda_gas_alto: { l: 'Lambda media con gas ≥80 %', u: 'λ', d: 3, g: 'Motor', req: ['lambda', 'tps'] },
    susp_f_media_pct: { l: 'Horquilla: posición media', u: '% recorrido', d: 1, g: 'Suspensión', req: ['susp_f'] },
    susp_f_p5_pct: { l: 'Horquilla: percentil 5', u: '% recorrido', d: 1, g: 'Suspensión', req: ['susp_f'] },
    susp_f_p95_pct: { l: 'Horquilla: percentil 95', u: '% recorrido', d: 1, g: 'Suspensión', req: ['susp_f'] },
    susp_f_fondo_pct: { l: 'Horquilla: tiempo en el último 2 % del recorrido', u: '%', d: 2, g: 'Suspensión', req: ['susp_f', 'travelF'] },
    susp_f_fondo_n: { l: 'Horquilla: veces detectadas al final del recorrido', u: '', d: 0, g: 'Suspensión', req: ['susp_f', 'travelF'] },
    susp_f_extension_pct: { l: 'Horquilla: tiempo en el primer 2 % (extensión)', u: '%', d: 2, g: 'Suspensión', req: ['susp_f', 'travelF'] },
    susp_f_extension_n: { l: 'Horquilla: veces en extensión máxima', u: '', d: 0, g: 'Suspensión', req: ['susp_f', 'travelF'] },
    susp_f_mitad_curva_pct: { l: 'Horquilla: posición a mitad de curva', u: '% recorrido', d: 1, g: 'Suspensión', req: ['susp_f', 'spd'] },
    susp_f_vel_comp_p95: { l: 'Horquilla: velocidad de compresión (percentil 95)', u: 'mm/s', d: 0, g: 'Suspensión', req: ['susp_f', 'hz100'] },
    susp_f_vel_ext_p95: { l: 'Horquilla: velocidad de extensión (percentil 95)', u: 'mm/s', d: 0, g: 'Suspensión', req: ['susp_f', 'hz100'] },
    susp_r_media_pct: { l: 'Amortiguador: posición media', u: '% recorrido', d: 1, g: 'Suspensión', req: ['susp_r'] },
    susp_r_p5_pct: { l: 'Amortiguador: percentil 5', u: '% recorrido', d: 1, g: 'Suspensión', req: ['susp_r'] },
    susp_r_p95_pct: { l: 'Amortiguador: percentil 95', u: '% recorrido', d: 1, g: 'Suspensión', req: ['susp_r'] },
    susp_r_fondo_pct: { l: 'Amortiguador: tiempo en el último 2 % del recorrido', u: '%', d: 2, g: 'Suspensión', req: ['susp_r', 'travelR'] },
    susp_r_fondo_n: { l: 'Amortiguador: veces detectadas al final del recorrido', u: '', d: 0, g: 'Suspensión', req: ['susp_r', 'travelR'] },
    susp_r_extension_pct: { l: 'Amortiguador: tiempo en el primer 2 % (extensión)', u: '%', d: 2, g: 'Suspensión', req: ['susp_r', 'travelR'] },
    susp_r_extension_n: { l: 'Amortiguador: veces en extensión máxima', u: '', d: 0, g: 'Suspensión', req: ['susp_r', 'travelR'] },
    susp_r_mitad_curva_pct: { l: 'Amortiguador: posición a mitad de curva', u: '% recorrido', d: 1, g: 'Suspensión', req: ['susp_r', 'spd'] },
    susp_r_vel_comp_p95: { l: 'Amortiguador: velocidad de compresión (percentil 95)', u: 'mm/s', d: 0, g: 'Suspensión', req: ['susp_r', 'hz100'] },
    susp_r_vel_ext_p95: { l: 'Amortiguador: velocidad de extensión (percentil 95)', u: 'mm/s', d: 0, g: 'Suspensión', req: ['susp_r', 'hz100'] },
    lean_max: { l: 'Inclinación máxima (percentil 99,9)', u: '°', d: 1, g: 'Ducati (CAN)', req: ['lean'] },
    lean_p95: { l: 'Inclinación (percentil 95)', u: '°', d: 1, g: 'Ducati (CAN)', req: ['lean'] },
    pitch_p5: { l: 'Cabeceo percentil 5', u: '°', d: 1, g: 'Ducati (CAN)', req: ['pitch'] },
    pitch_p95: { l: 'Cabeceo percentil 95', u: '°', d: 1, g: 'Ducati (CAN)', req: ['pitch'] },
    par_lento_pct: { l: 'Tiempo con reducción de par lenta', u: '%', d: 1, g: 'Ducati (CAN)', req: ['tq_slow'] },
    par_lento_n: { l: 'Eventos de reducción de par lenta', u: '', d: 0, g: 'Ducati (CAN)', req: ['tq_slow'] },
    par_rapido_pct: { l: 'Tiempo con reducción de par rápida', u: '%', d: 1, g: 'Ducati (CAN)', req: ['tq_fast'] },
    par_rapido_n: { l: 'Eventos de reducción de par rápida', u: '', d: 0, g: 'Ducati (CAN)', req: ['tq_fast'] },
    accx_p5: { l: 'Aceleración X percentil 5 (unidad del archivo: G o m/s²)', u: '', d: 2, g: 'Ducati (CAN)', req: ['acc_x'] },
    accx_p95: { l: 'Aceleración X percentil 95 (unidad del archivo: G o m/s²)', u: '', d: 2, g: 'Ducati (CAN)', req: ['acc_x'] },
    accy_p5: { l: 'Aceleración Y percentil 5 (unidad del archivo: G o m/s²)', u: '', d: 2, g: 'Ducati (CAN)', req: ['acc_y'] },
    accy_p95: { l: 'Aceleración Y percentil 95 (unidad del archivo: G o m/s²)', u: '', d: 2, g: 'Ducati (CAN)', req: ['acc_y'] }
  };
  for (let g = 1; g <= 7; g++) MDEF['marcha_' + g + '_pct'] = { l: 'Tiempo en ' + g + 'ª marcha', u: '%', d: 1, g: 'Motor', req: ['rpm'] };
  const LAP_KEYS = ['vmax', 'vmin', 'gas_pleno_pct', 'freno_d_pmax', 'freno_d_zonas', 'bloqueo_del_n', 'patinaje_max', 'patinaje_n', 'susp_f_media_pct', 'susp_r_media_pct', 'susp_f_fondo_n', 'susp_r_fondo_n', 'susp_f_mitad_curva_pct', 'susp_r_mitad_curva_pct', 'agua_max', 'lean_max', 'par_lento_pct', 'par_rapido_pct'];
  function metricLabel(id) {
    const m = /^(S|L(\d+))\.(.+)$/.exec(id); if (!m) return id;
    const d = MDEF[m[3]]; const nm = d ? d.l : m[3];
    return (m[1] === 'S' ? 'Sesión' : 'Vuelta ' + m[2]) + ' · ' + nm;
  }
  function metricUnit(id) { const m = /^(?:S|L\d+)\.(.+)$/.exec(id); return m && MDEF[m[1]] ? MDEF[m[1]].u : ''; }

  /* --- análisis completo --- */
  function analyze(table, mapping, meta, profile, opts) {
    meta = meta || {}; opts = opts || {};
    const P = Object.assign({}, PARAM, opts.param || {});
    const S = buildSeries(table, mapping, meta); if (S.error) return { error: S.error };
    const prof = PERFILES[profile] || {};
    const calidad = []; const q = (nivel, texto) => calidad.push({ nivel, texto });
    const addNote = x => { if (typeof x === 'string') q('info', x); else q(x.nivel || 'info', x.texto); };
    S.notes.forEach(addNote);
    q('info', S.n + ' filas · ' + rnd(S.hz, 1) + ' Hz · ' + rnd(S.dur / 60, 1) + ' min');
    if (isNum(S.hz) && S.hz < 100 && (S.susp_f || S.susp_r)) q('atencion', 'Muestreo de ' + rnd(S.hz, 1) + ' Hz: los toques de fondo y los picos de suspensión son breves (decenas de milisegundos) y a esta frecuencia se pierden muchos; las cifras de fondo son SIEMPRE un mínimo («detectadas a ' + rnd(S.hz, 0) + ' Hz»). La velocidad del amortiguador solo se calcula a 100 Hz o más.');
    else if (isNum(S.hz) && S.hz < 19.95) q('atencion', 'Muestreo bajo (' + rnd(S.hz, 1) + ' Hz).');
    if (S.gaps > 0) q('atencion', S.gaps + ' salto(s) de tiempo grandes (posible corte de registro).');
    // acelerador: «gas pleno» se mide contra el máximo real del canal (una calibración corta no debe dar 0 %)
    if (S.tps) {
      const st = finiteSorted(S.tps, 0, S.n); const mx = st[st.length - 1], ref = pctl(st, 0.995);
      if (mx < 60 || mx > 140) q('atencion', 'El acelerador llega a ' + rnd(mx, 1) + ' %: revisa la unidad o la calibración (se espera cerca de 100 %).');
      else if (ref < P.gasPleno) { P.gasPleno = 0.95 * ref; q('atencion', 'El acelerador solo llega a ' + rnd(ref, 1) + ' %: «gas pleno» se mide como el 95 % de ese máximo (' + rnd(P.gasPleno, 1) + ' %). Revisa la calibración del acelerador.'); }
    }
    const laps = segmentLaps(S, opts); laps.notes.forEach(addNote);
    const valid = laps.laps.filter(l => l.valida);
    if (!valid.length) return { error: 'No hay vueltas incluidas: marca al menos una para analizar.' };
    const ranges = valid.map(l => [l.i0, l.i1]);
    // referencia de velocidad para curvas / gas: la rueda antes que el GPS
    if (S.spdDynSrc === 'gps_speed') q('atencion', 'Sin velocidad de rueda: las curvas, la posición a mitad de curva y el tiempo hasta gas pleno se calculan con el GPS, que puede ir retrasado décimas de segundo. Úsalos para comparar, no como cifra exacta.');
    // marcha estimada: solo se numera si salen EXACTAMENTE las marchas de la moto
    S.gearEst = null; let gearInfo = null;
    if (!S.gear && S.rpm && (S.v_rear || S.gps_speed)) {
      gearInfo = estimateGears(S, ranges, prof.marchas);
      if (gearInfo && gearInfo.ok) { S.gearEst = assignGear(S, gearInfo); q('info', 'Marcha estimada por RPM/velocidad (' + gearInfo.centers.length + ' marchas distinguidas): no es un canal de la moto, úsala solo como orientación.'); }
      else q('atencion', 'No se estiman marchas: ' + (gearInfo && gearInfo.peaks != null ? 'se distinguieron ' + gearInfo.peaks + ' grupos de relación y la moto tiene ' + (prof.marchas || '?') + ' marchas (si falta una no se sabe cuál); ' : '') + 'sin una marcha fiable no se calculan los porcentajes por marcha. Para una estimación fiable harían falta las relaciones reales de la caja.');
    }
    // contexto de cálculo
    const ctx = { P, brakeRef: {}, slipBase: null, rpmLimit: NaN };
    for (const k of ['brake_f', 'brake_r']) if (S[k]) { const s = finiteSorted(S[k], 0, S.n); ctx.brakeRef[k] = pctl(s, 0.99); if (!(ctx.brakeRef[k] > 1)) q('atencion', 'La presión de freno apenas varía: ¿sensor sin conectar o unidad distinta?'); }
    if (isNum(+meta.rpmLimite) && +meta.rpmLimite > 3000) ctx.rpmLimit = +meta.rpmLimite;
    if (S.clutch) { const s = finiteSorted(S.clutch, 0, S.n); const u = new Set(s.slice(0, 5000).map(x => Math.round(x))); ctx.clutchBinary = u.size <= 3; ctx.clutchHigh = pctl(s, 0.999) * 0.5; }
    // línea base del patinaje: relación rueda trasera / rueda delantera en inercia (gas cerrado). Sin rueda delantera no se calcula.
    if (S.v_rear && S.tps && !S.v_front) q('info', 'Sin rueda delantera no se calcula el patinaje trasero (con el GPS saldría inventado).');
    if (S.v_rear && S.v_front && S.tps) {
      const ref = S.v_front; const r = []; ranges.forEach(([a, b]) => { for (let i = a; i < b; i += 2) if (S.tps[i] <= 5 && ref[i] > 40 && S.v_rear[i] > 0) r.push(S.v_rear[i] / ref[i]); });
      if (r.length > 200) { r.sort((x, y) => x - y); ctx.slipBase = pctl(r, 0.5); if (Math.abs(ctx.slipBase - 1) > 0.03) q('atencion', 'La rueda trasera marca ' + rnd((ctx.slipBase - 1) * 100, 1) + ' % respecto a la rueda delantera en inercia: revisa las circunferencias o los pulsos configurados. El patinaje se mide respecto a esa base.'); }
      else q('atencion', 'No hay suficiente tramo con gas cerrado para fijar la base del patinaje; no se calcula.');
    }
    // métricas por vuelta
    const M = {}; const lapTable = []; const rowByNum = {};
    laps.laps.forEach(l => {
      const row = { num: l.num, tiempo: l.tiempo, valida: l.valida, motivo: l.motivo || null, t0: l.t0, sinVueltas: !!l.sinVueltas, parcial: !!l.parcial };
      if (l.valida && !l.sinVueltas) {
        const rm = rangeMetrics(S, l.i0, l.i1, ctx); row.m = rm;
        M['L' + l.num + '.tiempo'] = l.tiempo;
        LAP_KEYS.forEach(k => { if (isNum(rm[k])) M['L' + l.num + '.' + k] = rm[k]; });
      } else if (!l.sinVueltas) { M['L' + l.num + '.tiempo'] = l.tiempo; }
      lapTable.push(row); rowByNum[l.num] = row;
    });
    // métricas de sesión: sobre la unión de vueltas válidas
    const SS = concatSeries(S, ranges);
    SS.gearEst = SS.gearEst || null;
    const sm = rangeMetrics(SS, 0, SS.n, Object.assign({}, ctx, { noApex: false }));
    // las curvas deben contarse por vuelta, no sobre la unión (los saltos entre vueltas confundirían los ápices)
    const apexTotal = valid.reduce((s, l) => s + ((rowByNum[l.num] && rowByNum[l.num].m || {}).curvas_n || 0), 0);
    if (apexTotal) sm.curvas_n = apexTotal;
    Object.keys(sm).forEach(k => { if (isNum(sm[k])) M['S.' + k] = sm[k]; });
    // estadísticas de vueltas
    const vt = valid.filter(l => !l.sinVueltas).map(l => l.tiempo);
    if (vt.length) { M['S.vueltas_validas'] = vt.length; M['S.mejor_vuelta'] = Math.min(...vt); M['S.vuelta_media'] = vt.reduce((a, b) => a + b, 0) / vt.length; if (vt.length > 1) { const m = M['S.vuelta_media']; M['S.vuelta_desv'] = Math.sqrt(vt.reduce((a, b) => a + (b - m) * (b - m), 0) / (vt.length - 1)); } }
    // histogramas de suspensión (10 tramos de recorrido)
    const hist = {};
    for (const ax of ['f', 'r']) {
      const a = SS['susp_' + ax]; if (!a) continue; const T = S['info_susp_' + ax].travel; const h = new Array(10).fill(0); let tot = 0;
      for (let i = 0; i < SS.n; i++) { const v = a[i]; if (v === v) { let b = Math.floor(100 * v / T / 10); b = b < 0 ? 0 : b > 9 ? 9 : b; h[b]++; tot++; } }
      if (tot) { hist['susp_' + ax] = h.map(x => rnd(100 * x / tot, 2)); h.forEach((x, b) => { M['S.susp_' + ax + '_hist' + (b * 10)] = rnd(100 * x / tot, 2); }); }
    }
    // tendencia de la temperatura de agua (°C por minuto): sobre todo el tiempo y sobre el último tercio (el calentamiento normal no es una alarma)
    if (S.water_temp && ranges.length) {
      const pts = []; ranges.forEach(([a, b]) => { for (let i = a; i < b; i += Math.max(1, (S.hz | 0))) pts.push([S.t[i] / 60, S.water_temp[i]]); });
      const slope = arr => { if (arr.length < 10) return NaN; const mx = arr.reduce((a, b) => a + b[0], 0) / arr.length, my = arr.reduce((a, b) => a + b[1], 0) / arr.length; let nu = 0, de = 0; for (const [x, y] of arr) { nu += (x - mx) * (y - my); de += (x - mx) * (x - mx); } return de > 0 ? nu / de : NaN; };
      const sAll = slope(pts); if (isNum(sAll)) M['S.agua_tendencia'] = sAll;
      const sEnd = slope(pts.slice(Math.floor(pts.length * 2 / 3))); if (isNum(sEnd)) M['S.agua_tendencia_final'] = sEnd;
    }
    MDEF.agua_tendencia = { l: 'Tendencia de la temperatura de agua (toda la sesión)', u: '°C/min', d: 2, g: 'Motor', req: ['water_temp'] };
    MDEF.agua_tendencia_final = { l: 'Tendencia de la temperatura de agua (último tercio)', u: '°C/min', d: 2, g: 'Motor', req: ['water_temp'] };
    // niveles de electrónica (Ducati): valor más frecuente y si cambian durante la sesión
    for (const [k, nm] of [['tc_level', 'tc'], ['ebc_level', 'ebc'], ['map_level', 'map'], ['dwc_level', 'dwc'], ['dsc_level', 'dsc']]) {
      if (!S[k]) continue; const cnt = {}; for (let i = 0; i < SS.n; i += 3) { const v = Math.round(SS[k][i]); if (v === v) cnt[v] = (cnt[v] || 0) + 1; }
      const ks = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]); if (ks.length) { M['S.nivel_' + nm] = +ks[0]; M['S.nivel_' + nm + '_cambios'] = ks.length - 1; }
      MDEF['nivel_' + nm] = { l: 'Nivel ' + nm.toUpperCase() + ' más usado', u: '', d: 0, g: 'Ducati (CAN)', req: [k] };
      MDEF['nivel_' + nm + '_cambios'] = { l: 'Valores distintos de ' + nm.toUpperCase() + ' en la sesión', u: '', d: 0, g: 'Ducati (CAN)', req: [k] };
    }
    ['vueltas_validas', 'mejor_vuelta', 'vuelta_media', 'vuelta_desv'].forEach(k => { MDEF[k] = { l: { vueltas_validas: 'Vueltas válidas', mejor_vuelta: 'Mejor vuelta', vuelta_media: 'Vuelta media', vuelta_desv: 'Desviación entre vueltas' }[k], u: k === 'vueltas_validas' ? '' : 's', d: k === 'vueltas_validas' ? 0 : 3, g: 'Tiempos', req: ['t'] }; });
    for (const ax of ['f', 'r']) for (let b = 0; b < 100; b += 10) MDEF['susp_' + ax + '_hist' + b] = { l: (ax === 'f' ? 'Horquilla' : 'Amortiguador') + ': tiempo entre ' + b + ' y ' + (b + 10) + ' % del recorrido', u: '%', d: 2, g: 'Suspensión', req: ['susp_' + ax] };
    // redondeo
    Object.keys(M).forEach(id => { const k = id.replace(/^(S|L\d+)\./, ''); const d = MDEF[k] ? MDEF[k].d : 2; M[id] = rnd(M[id], d); });
    lapTable.forEach(r => { if (r.m) Object.keys(r.m).forEach(k => { const d = MDEF[k] ? MDEF[k].d : 2; r.m[k] = rnd(r.m[k], d); }); });
    // qué no se pudo calcular
    const hasCh = k => k === 'spd' ? !!S.spd : k === 't' ? true : k === 'hz100' ? S.hz >= 99.5 : k === 'rpmLimit' ? isNum(ctx.rpmLimit) : k === 'travelF' ? !!(S.info_susp_f && !S.info_susp_f.rel && !S.info_susp_f.rangoDudoso) : k === 'travelR' ? !!(S.info_susp_r && !S.info_susp_r.rel && !S.info_susp_r.rangoDudoso) : !!S[k];
    const noVerif = [];
    const seenG = {};
    Object.keys(MDEF).forEach(k => {
      if (/^marcha_|_hist\d+$|^nivel_|_cambios$|^agua_tend/.test(k)) return;
      const d = MDEF[k]; const miss = d.req.filter(r => !hasCh(r)); if (!miss.length) return;
      if (d.g === 'Ducati (CAN)' && profile !== 'i2m-ducati') return;
      const falta = miss.map(r => r === 'spd' ? 'velocidad (GPS o rueda)' : r === 'hz100' ? 'muestreo de al menos 100 Hz' : r === 'rpmLimit' ? 'RPM del limitador (ficha)' : r === 'travelF' ? 'recorrido físico de la horquilla (coherente con el sensor)' : r === 'travelR' ? 'recorrido físico del amortiguador (coherente con el sensor)' : (CANALES[r] ? CANALES[r].label : r));
      const key = d.g + '|' + falta.join(', ');
      if (!seenG[key]) { seenG[key] = { grupo: d.g, falta: falta.join(', '), metricas: [] }; noVerif.push(seenG[key]); }
      seenG[key].metricas.push(d.l);
    });
    const rangos = {}; Object.keys(S.rangos || {}).forEach(k => { rangos[k] = { min: rnd(S.rangos[k].min, 2), max: rnd(S.rangos[k].max, 2) }; });
    const canales = Object.keys(S.has);
    return { S, perfil: profile, metricas: M, tabla: lapTable, vueltas: laps.laps, metodoVueltas: laps.method, hist, calidad, noVerificable: noVerif, marcha: gearInfo, ctx: { slipBase: ctx.slipBase, rpmLimit: ctx.rpmLimit, gasPleno: P.gasPleno }, hz: S.hz, dur: S.dur, n: S.n, spdSrc: S.spdSrc, spdDynSrc: S.spdDynSrc, rangos, canales, infoSusp: { f: S.info_susp_f || null, r: S.info_susp_r || null } };
  }
  function concatSeries(S, ranges) {
    const tot = ranges.reduce((s, [a, b]) => s + (b - a), 0); const R = { n: tot, hz: S.hz, has: S.has };
    for (const k of Object.keys(S)) {
      const v = S[k]; if (v && v.length === S.n && (v instanceof Float64Array || v instanceof Uint8Array)) { const out = new v.constructor(tot); let p = 0; for (const [a, b] of ranges) { out.set(v.subarray(a, b), p); p += b - a; } R[k] = out; }
      else if (k.indexOf('info_') === 0) R[k] = v;
    }
    R.spd = S.spdSrc ? R[S.spdSrc] : null; R.spdSrc = S.spdSrc; R.spdDyn = S.spdDynSrc ? R[S.spdDynSrc] : null; R.spdDynSrc = S.spdDynSrc; R.gearEst = R.gearEst || null;
    return R;
  }

  /* --- comparación con una línea base (sesión anterior del mismo perfil) --- */
  const HZ_DEPEND = /vel_comp|vel_ext|fondo_|extension_/; // dependen de la frecuencia de muestreo: no se comparan entre frecuencias distintas
  // Los conteos (veces, frenadas, curvas…) dependen de cuántas vueltas tiene cada sesión: se comparan POR VUELTA válida, no en bruto.
  const ES_CONTEO = id => /^S\.(.+_n|.+_zonas)$/.test(id) && !/^S\.nivel_/.test(id);
  function compareMetrics(curr, base, opts) {
    opts = opts || {}; const sens = opts.sens || 0.1; const out = [];
    const vc = isNum(curr['S.vueltas_validas']) && curr['S.vueltas_validas'] > 0 ? curr['S.vueltas_validas'] : 1, vb = isNum(base['S.vueltas_validas']) && base['S.vueltas_validas'] > 0 ? base['S.vueltas_validas'] : 1;
    Object.keys(curr).forEach(id => {
      if (id.indexOf('S.') !== 0 || /hist\d+$/.test(id) || id === 'S.vueltas_validas' || !Object.prototype.hasOwnProperty.call(base, id)) return;
      if (opts.hzDistinto && HZ_DEPEND.test(id)) return;
      let a = curr[id], b = base[id]; if (!isNum(a) || !isNum(b)) return;
      const k = id.slice(2), d = MDEF[k]; if (!d) return;
      const porVuelta = ES_CONTEO(id); if (porVuelta) { a = rnd(a / vc, 2); b = rnd(b / vb, 2); }
      const diff = a - b; const rel = b !== 0 ? diff / Math.abs(b) : (a !== 0 ? Infinity : 0);
      const minAbs = porVuelta ? 0.25 : (d.d === 0 ? 1 : Math.pow(10, -(d.d)) * 3);
      if (Math.abs(rel) >= sens && Math.abs(diff) >= minAbs) out.push({ id, actual: a, base: b, diff: rnd(diff, porVuelta ? 2 : d.d + 1), rel: isFinite(rel) ? rnd(rel * 100, 1) : null, porVuelta });
    });
    out.sort((x, y) => Math.abs(y.rel == null ? 1e9 : y.rel) - Math.abs(x.rel == null ? 1e9 : x.rel));
    return out.slice(0, 20);
  }
  // ¿Se puede comparar esta sesión con la base? Mismo circuito, misma moto, mismo neumático y misma frecuencia.
  function sameCircuit(x, y) { // true: igual; 'parecido': uno contiene al otro («Jerez» / «Circuito de Jerez»); false: distinto
    const nx = norm(x == null ? '' : x), ny = norm(y == null ? '' : y); if (!nx || !ny) return false; if (nx === ny) return true;
    const cor = nx.length <= ny.length ? nx : ny; return cor.length >= 4 && (nx.indexOf(ny) >= 0 || ny.indexOf(nx) >= 0) ? 'parecido' : false;
  }
  function comparabilidad(metaA, metaB, hzA, hzB) {
    const n = x => norm(x == null ? '' : x); const av = [], bloqueos = []; let hzDistinto = false;
    const a = metaA || {}, b = metaB || {};
    const sc = sameCircuit(a.circuito, b.circuito);
    if (n(a.circuito) && n(b.circuito) && !sc) bloqueos.push('Circuito distinto («' + b.circuito + '» frente a «' + a.circuito + '»): los cambios serían de la pista, no del reglaje. Si es el mismo, escríbelo igual en las dos fichas.');
    else if (!n(a.circuito) || !n(b.circuito)) av.push('Falta el circuito en una de las dos sesiones: no se puede asegurar que sea la misma pista.');
    else if (sc === 'parecido') av.push('El circuito está escrito distinto («' + b.circuito + '» y «' + a.circuito + '»): se tomó como la misma pista. Compruébalo.');
    if (n(a.moto) && n(b.moto) && n(a.moto) !== n(b.moto)) bloqueos.push('Moto distinta («' + b.moto + '» frente a «' + a.moto + '»): cada moto tiene sensores y reglajes distintos.');
    else if (!!n(a.moto) !== !!n(b.moto)) bloqueos.push('Falta la moto en una de las dos sesiones: no se puede asegurar que sea la misma (cada moto tiene sensores y reglajes distintos). Escríbela en la ficha de la sesión que no la tiene.');
    else if (!n(a.moto) && !n(b.moto)) av.push('Falta la moto en las dos sesiones: no se puede asegurar que sea la misma.');
    if (n(a.condicion) && n(b.condicion) && n(a.condicion) !== n(b.condicion)) bloqueos.push('Pista distinta («' + b.condicion + '» frente a «' + a.condicion + '»): seco y mojado cargan la suspensión de forma muy distinta; los cambios no serían del reglaje.');
    else if (!n(a.condicion) || !n(b.condicion)) av.push('Falta indicar si la pista estaba seca o mojada en una de las dos sesiones.');
    if (n(a.neumatico) && n(b.neumatico) && n(a.neumatico) !== n(b.neumatico)) av.push('Neumático distinto: parte de los cambios puede ser del neumático.');
    if (n(a.piloto) && n(b.piloto) && n(a.piloto) !== n(b.piloto)) av.push('Piloto distinto: parte de los cambios puede ser de pilotaje.');
    if (isNum(hzA) && isNum(hzB) && Math.abs(hzA - hzB) / Math.max(hzA, hzB) > 0.2) { hzDistinto = true; av.push('Frecuencia de muestreo distinta (' + rnd(hzA, 0) + ' Hz frente a ' + rnd(hzB, 0) + ' Hz): no se comparan fondo ni velocidades de suspensión.'); }
    return { ok: !bloqueos.length, bloqueos, avisos: av, hzDistinto };
  }

  /* =====================================================================
     6. Alertas del equipo con umbrales PROVISIONALES (definidos por el equipo, sin calibrar con la flota)
     ===================================================================== */
  function reglas(A, meta, profile) {
    const M = A.metricas, R = []; const g = k => M['S.' + k]; const hz = rnd(A.hz, 0);
    const add = (id, sev, titulo, texto, ev, umbral) => R.push({ id, severidad: sev, titulo, texto, umbral, evidencia: ev.filter(e => e in M), estado: 'hipótesis a probar' });
    if (isNum(g('susp_f_fondo_n')) && g('susp_f_fondo_n') > 0) add('R-FONDO-F', 'atencion', 'La horquilla llega al final del recorrido', 'La horquilla tocó el último 2 % del recorrido indicado: ' + veces(g('susp_f_fondo_n')) + ' detectadas a ' + hz + ' Hz (' + g('susp_f_fondo_pct') + ' % del tiempo). A baja frecuencia puede haber más toques sin ver.', ['S.susp_f_fondo_n', 'S.susp_f_fondo_pct'], '≥ 98 % del recorrido indicado');
    if (isNum(g('susp_r_fondo_n')) && g('susp_r_fondo_n') > 0) add('R-FONDO-R', 'atencion', 'El amortiguador llega al final del recorrido', 'El amortiguador tocó el último 2 % del recorrido indicado: ' + veces(g('susp_r_fondo_n')) + ' detectadas a ' + hz + ' Hz (' + g('susp_r_fondo_pct') + ' % del tiempo). A baja frecuencia puede haber más toques sin ver.', ['S.susp_r_fondo_n', 'S.susp_r_fondo_pct'], '≥ 98 % del recorrido indicado');
    if (isNum(g('susp_f_extension_n')) && g('susp_f_extension_n') > 3) add('R-EXT-F', 'info', 'La horquilla vuelve a extensión máxima', 'La horquilla estuvo en extensión máxima ' + g('susp_f_extension_n') + ' veces; puede ser caballito, frenada con suelta brusca o falta de precarga.', ['S.susp_f_extension_n'], '≤ 2 % del recorrido, más de 3 veces');
    if (isNum(g('patinaje_n')) && g('patinaje_n') > 0) add('R-PATINAJE', 'info', 'La rueda trasera supera a la delantera con el gas abierto', 'Hubo ' + g('patinaje_n') + ' evento(s) con la trasera más de 5 % sobre la rueda delantera (máximo: ' + g('patinaje_max') + ' %). Un poco de deslizamiento es normal en tracción; depende de la calibración de circunferencias.', ['S.patinaje_n', 'S.patinaje_max'], 'trasera > 5 % sobre la delantera, gas ≥ 30 %');
    if (isNum(g('bloqueo_del_n')) && g('bloqueo_del_n') > 0) add('R-BLOQUEO', 'atencion', 'Indicios de bloqueo del delantero', 'La rueda delantera giró bajo el 85 % de la referencia con el freno aplicado en ' + g('bloqueo_del_n') + ' ocasión(es). Mira la traza: si la velocidad cae a 0,0 de golpe es el sensor, no la rueda (esas caídas no se cuentan).', ['S.bloqueo_del_n'], 'delantera < 85 % de la trasera/GPS con freno aplicado');
    if (isNum(g('susp_f_media_pct')) && isNum(g('susp_r_media_pct'))) add('R-REPARTO', 'info', 'Reparto de uso del recorrido', 'Posición media: horquilla ' + g('susp_f_media_pct') + ' % y amortiguador ' + g('susp_r_media_pct') + ' % del recorrido. Sin sesión base no se puede decir si es alto o bajo.', ['S.susp_f_media_pct', 'S.susp_r_media_pct'], 'sin umbral: compara con otra sesión');
    if (A.ctx && isNum(A.ctx.slipBase) && Math.abs(A.ctx.slipBase - 1) > 0.03) add('R-CIRC', 'atencion', 'Revisar circunferencias o pulsos de rueda', 'La relación rueda trasera/delantera en inercia es ' + rnd(A.ctx.slipBase, 3) + ' (se espera cerca de 1).', [], 'relación fuera de 0,97–1,03');
    if (isNum(g('nivel_tc_cambios')) && g('nivel_tc_cambios') > 0) add('R-ELEC', 'info', 'La electrónica cambió durante la sesión', 'El nivel de control de tracción tomó más de un valor; compara por separado los tramos.', ['S.nivel_tc_cambios'], 'más de un valor');
    const aguaAviso = +((meta || {}).aguaAviso);
    if (isNum(g('agua_tendencia_final')) && g('agua_tendencia_final') > 0.3) add('R-AGUA', 'info', 'La temperatura de agua sigue subiendo al final de la sesión', 'En el último tercio de la sesión la temperatura sube ' + g('agua_tendencia_final') + ' °C por minuto (máxima ' + g('agua_max') + ' °C). Es la pendiente, no el nivel: un motor que aún se calienta sube así sin ser un problema. Mira el nivel alcanzado.', ['S.agua_tendencia_final', 'S.agua_max'], '> 0,3 °C/min en el último tercio (solo informativa)');
    if (isNum(aguaAviso) && aguaAviso > 40 && isNum(g('agua_max')) && g('agua_max') >= aguaAviso) add('R-AGUA-NIVEL', 'atencion', 'La temperatura de agua llegó a tu temperatura de aviso', 'La temperatura de agua llegó a ' + g('agua_max') + ' °C y tu temperatura de aviso es ' + aguaAviso + ' °C.', ['S.agua_max'], '≥ la temperatura de aviso de la ficha (' + aguaAviso + ' °C)');
    return R;
  }

  /* =====================================================================
     7. Prompts y validación de la IA
     ===================================================================== */
  function reglasDelPerfil(profile) {
    const p = PERFILES[profile];
    if (profile === '2d-moto4') return 'Moto: Honda NSF250R (monocilíndrica 4T 249 cc, 35,5 kW a 13.000 rpm, 6 marchas, 84 kg, neumáticos Pirelli) en la Moto4 / FIM MotoJunior. Logger 2D con GPS, suspensión delantera y trasera, rueda trasera, TPS y RPM; freno, rueda delantera, lambda y agua son opcionales; marcha, IMU y aceleraciones no vienen en el kit. ' + p.reglamento + ' Trabajos que puedes proponer (lista del reglamento 2019, por confirmar con el 2026): ' + p.trabajosPermitidos.join(', ') + '. NO recomiendes "clics" de compresión o extensión, ni vueltas de ajuste, ni precarga externa, ni mapas, ni presión de neumáticos, ni geometría o altura en tijas: no están confirmados como permitidos.';
    return 'Moto: Ducati (V4 R 2023 o V4 2025) con DataLog Pro de I2M, sin pantalla. Los canales que lleguen por CAN (RPM, velocidades de rueda, acelerador, marcha, inclinación, cabeceo, reducción de par, niveles electrónicos, temperaturas, aceleraciones) están POR CONFIRMAR con I2M: usa solo los que aparezcan en MÉTRICAS. Freno y suspensión solo existen si hay sensores analógicos mapeados. ' + p.reglamento + ' Puedes proponer cambios de reglaje y de niveles electrónicos como hipótesis a probar, de uno en uno.';
  }
  function systemPromptAnalisis(profile) {
    return 'Eres un telemetrista senior de motos de competición. Analizas datos de una sesión ya terminada (no hay telemetría en vivo) y hablas con Antonio D\'Angelo, dueño del equipo, en español neutro, de tú, sin voseo, directo y sin relleno.\n' +
      'REGLAS ESTRICTAS:\n' +
      '1. Usa SOLO las métricas del bloque MÉTRICAS. Cada hallazgo debe citar en "evidencia" ids exactos de ese bloque con su valor exacto, y toda cifra que escribas en el texto debe ser el valor de una métrica que cites en la evidencia de ese mismo hallazgo. Sin evidencia no hay hallazgo.\n' +
      '2. No inventes umbrales de diagnóstico. Si no hay LÍNEA BASE, di que es una lectura sin comparar y usa confianza "media" o "baja" (nunca "alta"). Con línea base, apóyate en los cambios del bloque CAMBIOS VS BASE (los conteos van por vuelta válida, no en bruto).\n' +
      '3. Los datos muestran síntomas, no causas. Formula la causa como hipótesis a probar, y propone UN solo cambio por vez, el de mayor prioridad.\n' +
      '4. Si para una conclusión falta un sensor o un dato (revisa NO VERIFICABLE y CALIDAD DE DATOS), dilo en "no_verificable" en vez de suponer. Las cifras de fondo de carrera son un mínimo a la frecuencia indicada.\n' +
      '5. Distingue reglaje de pilotaje cuando los datos lo permitan; si no, dilo.\n' +
      '6. Seguridad: el piloto puede ser menor de edad. Cambios de frenos, neumáticos o dirección solo como "revisar con el jefe mecánico antes de probar". Antes de proponer muelles pide el peso y la estatura del piloto. No propongas presiones de neumático (el kit no las mide). El reglamento aplicable puede ser distinto del ETC 2019.\n' +
      '7. ' + reglasDelPerfil(profile) + '\n' +
      'Devuelve SOLO JSON válido, sin markdown, con este esquema: {"resumen":"1-2 frases","prioridad":{"accion":"un solo cambio a probar","por_que":"","evidencia":[{"id":"","valor":0}]},"hallazgos":[{"titulo":"","categoria":"suspension|freno|gas|neumatico|motor|electronica|piloto|datos","evidencia":[{"id":"","valor":0}],"interpretacion":"qué muestran los datos","accion":"cambio concreto a probar o vacío","confianza":"alta|media|baja"}],"no_verificable":["..."],"preguntas_al_piloto":["..."]}. Sé breve: cada texto de 1 o 2 frases y máximo 5 hallazgos.';
  }
  function fmtMetric(id, v) { const u = metricUnit(id); return id + ' = ' + v + (u ? ' ' + u : '') + '  (' + metricLabel(id) + ')'; }
  function userPayloadAnalisis(A, meta, profile, cambios, baseInfo) {
    const P = PERFILES[profile]; const L = [];
    L.push('PERFIL: ' + P.titulo);
    L.push('FICHA: ' + JSON.stringify(slimMeta(meta)));
    L.push('CALIDAD DE DATOS:\n' + A.calidad.map(c => '- [' + c.nivel + '] ' + c.texto).join('\n'));
    L.push('VUELTAS: método ' + A.metodoVueltas + '; válidas ' + A.vueltas.filter(l => l.valida).map(l => l.num).join(', ') + '; no usadas: ' + (A.vueltas.filter(l => !l.valida).map(l => l.num + ' (' + l.motivo + ')').join('; ') || 'ninguna'));
    L.push('NO VERIFICABLE CON LOS CANALES MAPEADOS:\n' + (A.noVerificable.map(x => '- ' + x.grupo + ': falta ' + x.falta).join('\n') || '- (nada)'));
    L.push('LÍNEA BASE: ' + (baseInfo ? baseInfo : 'NO HAY (primera lectura sin comparar)'));
    if (cambios && cambios.length) L.push('CAMBIOS VS BASE (|cambio| ≥ sensibilidad):\n' + cambios.map(c => '- ' + c.id + ': ahora ' + c.actual + ', base ' + c.base + (c.porVuelta ? ' (por vuelta válida)' : '') + ' (' + (c.rel == null ? 'n/a' : c.rel + ' %') + ')').join('\n'));
    L.push('MÉTRICAS:\n' + Object.keys(A.metricas).filter(id => !/_hist\d+$/.test(id) || id.indexOf('S.') === 0).map(id => fmtMetric(id, A.metricas[id])).join('\n'));
    if (A.reglasDisparadas && A.reglasDisparadas.length) L.push('ALERTAS DEL EQUIPO DISPARADAS (umbrales provisionales; hipótesis a probar):\n' + A.reglasDisparadas.map(r => '- ' + r.id + ': ' + r.titulo + '. ' + r.texto).join('\n'));
    return L.join('\n\n');
  }
  function slimMeta(m) { const o = {}; Object.keys(m || {}).forEach(k => { const v = m[k]; if (v !== '' && v != null && typeof v !== 'object') o[k] = v; else if (v && typeof v === 'object') { const s = {}; Object.keys(v).forEach(j => { if (v[j] !== '' && v[j] != null) s[j] = v[j]; }); if (Object.keys(s).length) o[k] = s; } }); return o; }

  function repairJSON(s) { // respuesta cortada a la mitad: se queda con lo último completo y cierra llaves
    const stack = []; let inStr = false, esc = false, best = -1, bestStack = null;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '{' || ch === '[') stack.push(ch);
      else if (ch === '}' || ch === ']') { stack.pop(); if (stack.length >= 1) { best = i; bestStack = stack.slice(); } }
    }
    if (best < 0) return null;
    return s.slice(0, best + 1) + bestStack.reverse().map(c => c === '{' ? '}' : ']').join('');
  }
  function parseJSONLoose(raw) {
    let s = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const a = s.indexOf('{'), b = s.lastIndexOf('}'); if (a >= 0) s = s.slice(a, b > a ? b + 1 : undefined);
    try { return JSON.parse(s); } catch (e) {
      // texto previo con llaves («{nota}» antes del JSON): se prueba desde cada «{» siguiente
      for (let k = s.indexOf('{', 1), tries = 0; k > 0 && tries < 30; k = s.indexOf('{', k + 1), tries++) { try { const o = JSON.parse(s.slice(k)); if (o && typeof o === 'object' && !Array.isArray(o)) return o; } catch (e3) { } }
      const r = repairJSON(s); if (r) { try { const o = JSON.parse(r); o.__parcial = true; return o; } catch (e2) { } }
      throw e;
    }
  }
  const CATS = ['suspension', 'freno', 'gas', 'neumatico', 'motor', 'electronica', 'piloto', 'datos'];
  const CONF = ['alta', 'media', 'baja'];
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  // Qué métricas sustentan cada tipo de hallazgo: un hallazgo de «suspensión» que solo cita la velocidad máxima no se acepta.
  const CAT_METRICAS = {
    suspension: /^(S|L\d+)\.(susp_|vmin$)/, freno: /^(S|L\d+)\.(freno_|bloqueo_|susp_f_)/, gas: /^(S|L\d+)\.(gas_|apice_a_gas|rpm_medio_gas|patinaje|par_)/,
    neumatico: /^(S|L\d+)\.(patinaje|susp_|vmin|vmedia|par_|freno_|gas_)/, motor: /^(S|L\d+)\.(rpm|marcha_|agua_|lambda|gas_|vmax)/, electronica: /^(S|L\d+)\.(nivel_|par_|patinaje|lean|gas_)/,
    piloto: /./, datos: /./
  };
  // Trabajos que la IA NO puede proponer en la Moto4 (no confirmados como permitidos) y los que sí están en la lista.
  const RE_PROHIBIDO_2D = /\bcl[ií]cs?\b|\bclicks?\b|compresi[oó]n|rebote|extensi[oó]n\b.{0,25}\b(horquilla|amortiguador|cierra|abre|vueltas?)|\b(cierra|abre|aprieta|afloja|sube|baja|endurece|ablanda|suaviza|frena|acelera)\b.{0,30}\b(compresi|extensi|rebote|hidr[aá]ulic)|vueltas? (de|al|a la|en)\b|precarga|\bmapa\b|presi[oó]n de(l)? (los? )?(neum|aire)|(neum[aá]ticos?).{0,25}(bar|psi|presi)|geometr[ií]a|tijas?\b|altura (de|del|en)|\bsag\b|ride height/i;
  const RE_PERMITIDO_2D = /muelle|aceite|viscosidad|v[aá]lvula|pist[oó]n|pastilla|disco|bomba|cadena|pi[nñ][oó]n|corona|relaci[oó]n final|desarrollo/i;
  const RE_CAMBIO = /\b(?:cambi(?:a|ar|e|es|o)|sub(?:e|es|ir|a|as)|baj(?:a|as|ar|e|es)|apriet(?:a|e|es)|apret(?:ar|ando)|afloj(?:a|e|es|ar)|endurec(?:e|es|er|a)|ablanda(?:r|s)?|mont(?:a|ar|e|es|o)|instal(?:a|ar|e|es)|reduc(?:e|es|ir)|aument(?:a|ar|e|es)|sustitu(?:ye|ir|ya)|reemplaz(?:a|ar|e)|modific(?:a|ar|e)|ajust(?:a|ar|e)|pon(?:er|e|ga)?)\b/i;
  const RE_PIEZA = /pastilla|disco|bomba de freno|muelle|aceite|cadena|pi[nñ][oó]n|corona|v[aá]lvula|pist[oó]n/i;
  const RE_VERIFICAR = /repet|repit|medici|verific|compar|revis|calibr|comprob|compr[ou]eb|medir|mide|registr|confirma|pregunta|segunda sesi|otra sesi|toma de datos|sensor|jefe mec[aá]nico/i;
  // consejos de pilotaje: con un piloto posiblemente menor no se dan desde la app
  // Consejos de pilotaje INEQUÍVOCOS: se evalúan siempre, aunque la frase también hable de una pieza («Cambia las pastillas y pide al piloto que frene más tarde»).
  // Una orden de comprobar («Verifica que frene parejo», «Revisa si la moto frena más tarde») es trabajo de mecánico y no cuenta.
  // Los «(?<!…)» no los entiende un Safari anterior a 16.4: sin ellos la regla sigue funcionando, con algún rojo falso de más y ninguno de menos.
  const LB_OK = (() => { try { new RegExp('(?<!a)b'); return true; } catch (e) { return false; } })();
  const lb = s => (LB_OK ? s : '');
  const VERBOS_COMPROBAR = 'compru?eba|comprobar|verifica|verificar|revisa|revisar|mide|medir';
  const VERIF_QUE = lb(String.raw`(?<!\b(?:` + VERBOS_COMPROBAR + String.raw`)\s+(?:de\s+)?(?:que|si)\s+(?:(?!piloto\b)[^\s.;,]+\s+){0,3})`);
  const VERIF_ANTES = lb(String.raw`(?<!\b(?:` + VERBOS_COMPROBAR + String.raw`)\s+(?:de\s+)?)`);
  const PARA_ANTES = lb(String.raw`(?<!\bpara (?:que )?)`);
  const INT_PIL = String.raw`(?:antes|tarde|pronto|fuerte|r[aá]pido|agresiv\w*|duro|a fondo|m[aá]s (?:ritmo|velocidad)|con m[aá]s (?:fuerza|velocidad|ritmo|decisi[oó]n))`;
  const RE_PILOTAJE_FIRME = new RegExp([
    PARA_ANTES + VERIF_QUE + String.raw`\bfren(?:a|e|es)\b.{0,12}\b(?:m[aá]s )?(?:tarde|fuerte|agresiv|duro)`,
    String.raw`\babr(?:e|a|ir)\s+(?:el\s+)?gas\b.{0,15}\b(?:antes|m[aá]s (?:pronto|r[aá]pido|fuerte))`,
    String.raw`\babr(?:e|a|ir)\s+antes\s+(?:el\s+)?gas\b`,
    String.raw`\bentr(?:a|ar|e)\b.{0,10}\bm[aá]s (?:r[aá]pido|fuerte)`,
    String.raw`\bllev(?:a|ar|e)\s+m[aá]s\s+(?:velocidad|ritmo)`,
    String.raw`\bgas m[aá]s (?:pronto|fuerte)`,
    String.raw`\b(?:retras|apur)(?:a|ar|e)\b(?:(?!\b(?:pastillas?|discos?|bomba|cambio|sustituci[oó]n|revisi[oó]n)\b).){0,30}\b(?:frenada|freno)\b`,
    String.raw`\b(?:suelt(?:a|e)|soltar)\s+(?:el\s+)?freno\b(?:(?!\b(?:maneta|medir|mide|medici[oó]n)\b).){0,15}\b(?:antes|tarde|pronto)\b`,
    String.raw`\b(?:suelt(?:a|e)|soltar)\s+(?:antes|m[aá]s (?:tarde|pronto))\s+(?:el\s+)?freno\b`,
    String.raw`\bdej(?:a|ar|e)\s+de\s+frenar\b`,
    String.raw`\bacelera(?:r)?\s+(?:antes|m[aá]s pronto)|\bacelere\s+(?:antes|m[aá]s pronto)`,
    String.raw`\bcort(?:a|ar|e)\s+(?:el\s+)?gas\s+(?:antes|m[aá]s pronto)|\bcort(?:a|ar|e)\s+antes\s+(?:el\s+)?gas\b`,
    String.raw`\bgir(?:a|ar|e)\s+antes\b`,
    String.raw`\bmant[eé]n(?:er|ga)?\b.{0,12}\bgas\b`,
    String.raw`\b(?:cierr(?:a|e)|cerrar)\s+m[aá]s\b.{0,12}\btrazada`,
    String.raw`\bapriet(?:a|e)\s+m[aá]s\s+(?:el\s+)?(?:freno|gas|acelerador)\b`,
    String.raw`\b(?:p[ií]de|d[ií]le|dile|di|pide|recomienda|recomi[eé]ndale|sugiere|sugi[eé]rele|aconseja|acons[eé]jale)(?:le)?\s+al piloto\b[^.;]{0,40}\b(?:fren(?:e|ar)|acelere|acelerar|ataque|atacar|arriesgue|arriesgar|apure|apurar|retrase|retrasar|` + INT_PIL + String.raw`)`,
    String.raw`\bel piloto (?:debe|tiene que|deber[ií]a|puede)\b.{0,20}\b(?:frenar|acelerar|girar)\b`,
    PARA_ANTES + VERIF_ANTES + String.raw`\bque (?:el piloto )?(?:abra|entre|frene|acelere|gire|cierre|corte)\b.{0,15}\b(?:m[aá]s|antes|tarde|pronto|fuerte|r[aá]pido)\b`
  ].join('|'), 'i');
  // AMBIGUOS: pueden hablar de una pieza («cambia las pastillas para frenar más fuerte»); solo cuentan como pilotaje si la frase no es un trabajo de mecánico
  const RE_PILOTAJE_AMBIG = /\bfren(ar|ando)\b.{0,12}\b(m[aá]s )?(tarde|fuerte|agresiv)|\bm[aá]s agresiv/i;
  // Se mira cada trozo de la frase por separado: un trozo sin pieza ni verbo de comprobar que habla de conducir es pilotaje (o, si no se reconoce, amarillo) aunque otro trozo cambie una pieza
  const RE_TROZOS = /\s*(?:[;:\/\n\r()&+–—]|,(?!\d)|\.(?=\s|$)|\s-\s|\b(?:y|e|o|u|pero|luego|despu[eé]s|adem[aá]s|mientras|tambi[eé]n|as[ií] como|a la vez)\b)\s*/i;
  // El «para qué» o el «porque» de un cambio de pieza («Cambia el piñón para acelerar antes») explica el trabajo, no es una orden al piloto
  const RE_FIN = /\b(?:para(?: que)?|porque|ya que)\b(?:(?!\b(?:y|e|pero|luego|despu[eé]s)\b)[^.;,\/\n()&+]){0,40}/gi;
  const RE_PILOTAJE_TROZO = new RegExp([
    String.raw`\b(?:fren(?:a|ar|e|es)|acelera(?:r)?|acelere)\b[^.]{0,40}\b` + INT_PIL + String.raw`\b`,
    String.raw`\b(?:entr(?:a|ar|e)|gir(?:a|ar|e))\b(?!\s+(?:en\s+(?:contacto|boxes?|el box|pit|pista|la sesi\w+)|a\s+boxes?))[^.]{0,25}\b` + INT_PIL + String.raw`\b`,
    String.raw`\b(?:abr(?:e|a|ir)|cierr(?:a|e|ar)|cerrar|cort(?:a|ar|e)|(?:suelt(?:a|e)|soltar)|retras(?:a|ar|e)|apur(?:a|ar|e)|mant[eé]n(?:er|ga)?|dej(?:a|ar|e))\b(?=[^.]{0,80}\b(?:gas|acelerador|freno|frenada|trazada|curva)\b)(?=[^.]{0,80}\b(?:antes|tarde|pronto|fuerte|r[aá]pido|suave|tiempo)\b)`,
    String.raw`\b(?:mete|m[eé]tele|d[aá]le|da|aplica|ap[lí]cale)\s+(?:m[aá]s\s+)?(?:gas|freno|acelerador)\b`,
    String.raw`\b(?:atac(?:a|ar|e)|arriesg(?:a|ar|ue))\b`,
    String.raw`\bsub(?:e|ir)\s+el\s+ritmo\b`,
    String.raw`\bpas(?:a|ar|e)\s+m[aá]s\s+r[aá]pido\b`,
    String.raw`\bcambi(?:a|ar|e)\s+(?:de\s+)?marcha\b[^.]{0,10}\b(?:antes|tarde|pronto)\b`
  ].join('|'), 'i');
  // Vocabulario de conducir: un trozo que lo usa sin hablar de una pieza permitida ni de comprobar, y que no se reconoce arriba, sale al menos en amarillo
  const RE_CONDUCCION = /\b(?:fren\w*|gas|acelera\w*|trazada|curva|apoy\w*|[aá]pice|arriesg\w*|atac\w*|conduc\w*|pilota\w*)\b/i;
  const RE_VALVULAS = /(v[aá]lvulas?|pist[oó]n(es)?|shims?|\bpack\b)\s+(de\s+)?(compresi[oó]n|rebote|extensi[oó]n)/gi;
  function accionPermitida(accion, profile) {
    const orig = String(accion || ''), t0 = orig.replace(/\s+/g, ' ').trim(); if (!t0 || profile !== '2d-moto4') return { ok: true };
    const mecanico = RE_PIEZA.test(t0) && RE_CAMBIO.test(t0); // «Cambia las pastillas por otras más agresivas» es trabajo de mecánico, no consejo de pilotaje
    const normB = (mecanico ? orig.replace(RE_FIN, ' ') : orig).replace(/[\n\r]+/g, ' ; ').replace(/[ \t]+/g, ' ').trim(), base = normB.replace(/\s+/g, ' '); // normalizado una vez: evita que rachas largas de espacios en RE_TROZOS sean lentas
    const trozos = normB.split(RE_TROZOS).map(c => c.trim()).filter(c => c.length >= 4);
    const sinPieza = c => !RE_PIEZA.test(c) && !RE_PERMITIDO_2D.test(c) && !RE_VERIFICAR.test(c);
    const pilotajeTrozo = trozos.some(c => !RE_PIEZA.test(c) && !RE_VERIFICAR.test(c) && (RE_PILOTAJE_TROZO.test(c) || (!RE_CAMBIO.test(c) && RE_PILOTAJE_AMBIG.test(c))));
    if (RE_PILOTAJE_FIRME.test(base) || pilotajeTrozo || (!mecanico && RE_PILOTAJE_AMBIG.test(t0))) return { ok: false, tipo: 'pilotaje', motivo: 'Es un consejo de pilotaje, con riesgo físico para un piloto que puede ser menor: no se recomienda desde la app. Coméntalo con su entrenador.' };
    const t = t0.replace(RE_VALVULAS, 'válvula'); // «válvulas de compresión» son piezas internas permitidas, no «clics de compresión»
    if (RE_PROHIBIDO_2D.test(t)) return { ok: false, tipo: 'reglamento', motivo: 'Propone un ajuste que NO está confirmado como permitido en la Moto4 (clics o ajustes externos de compresión/extensión/rebote, vueltas de ajuste, precarga, mapa, geometría o tijas; la presión de neumáticos tampoco, porque el kit no la mide). Confírmalo con el reglamento 2026 antes de pensar en probarlo.' };
    const cambia = RE_CAMBIO.test(t); // «Revisa y endurece…»: la palabra de verificar no limpia un verbo de cambio
    if (trozos.some(c => sinPieza(c) && RE_CONDUCCION.test(c))) return { ok: 'dudoso', motivo: 'Una parte de la acción habla de conducir (frenar, acelerar, gas, curvas…) y no de una pieza de la lista permitida. Si es un consejo para el piloto, no se da desde la app (puede ser menor): coméntalo con su entrenador.' };
    if (!RE_PERMITIDO_2D.test(t) && (cambia || !RE_VERIFICAR.test(t))) return { ok: 'dudoso', motivo: 'No encaja con ninguna línea de trabajo de la lista permitida (muelles, aceite, válvulas y pistones internos, pastillas, discos, bomba de freno, cadena y piñones). Confírmalo con el reglamento 2026.' };
    return { ok: true };
  }
  // números que aparecen escritos en un texto libre (se ignoran numerales de vuelta/curva/marcha)
  function numerosDelTexto(txt) {
    const out = []; const t = String(txt || ''); const re = /(\d+(?:[.,]\d+)?)/g; let m;
    while ((m = re.exec(t))) {
      const pre = t.slice(Math.max(0, m.index - 14), m.index).toLowerCase(), post = t.slice(m.index + m[1].length, m.index + m[1].length + 6).toLowerCase();
      if (/(vuelta|curva|marcha|moto|sesi[oó]n|lap|turn)s?\s*(n[.º°]?\s*)?$/.test(pre) || /^\s*(ª|º|a marcha|\.?\s*(marcha|vuelta))/.test(post)) continue;
      if (/\bL$|\bS$|\b[LS]\d*\.$/.test(pre)) continue;
      const v = +m[1].replace(',', '.'); if (!isFinite(v)) continue;
      if (Number.isInteger(v) && v <= 3 && !/^\s*vez|^\s*veces/.test(post)) continue; // «1 cambio», «2 hallazgos»
      out.push(v);
    }
    return out;
  }
  function validateEvidence(ev, metricas) {
    const ok = [], bad = []; (Array.isArray(ev) ? ev : []).forEach(e => {
      if (!e || typeof e.id !== 'string' || !has(metricas, e.id)) { bad.push(e && e.id != null ? String(e.id) : '(sin id)'); return; }
      const real = metricas[e.id]; const dado = +e.valor; const tol = Math.max(Math.abs(real) * 0.02, 0.05);
      ok.push({ id: e.id, valor: real, corregido: !(isNum(dado) && Math.abs(dado - real) <= tol) });
    }); return { ok, bad };
  }
  function validateAnalysis(j, metricas, profile, ctx) {
    ctx = ctx || {}; j = j && typeof j === 'object' ? j : {};
    const out = { resumen: String(j.resumen || '').slice(0, 600), hallazgos: [], descartados: [], no_verificable: [], preguntas_al_piloto: [], prioridad: null, avisos: [], idsInventados: 0, cifrasSinRespaldo: 0 };
    // una cifra del texto solo se acepta si es el valor de una métrica CITADA en la evidencia de ese mismo hallazgo (o un dato de la ficha / un umbral fijo): con las ~160 métricas, casi cualquier entero coincidiría con alguna por casualidad
    const extra = (ctx.extraNums || []).filter(isNum).concat(Object.keys(PARAM).map(k => PARAM[k]), [85, 100, 30, 40]);
    const tolDe = v => Math.max(Math.abs(v) * 0.02, 0.06);
    const todaEvidencia = [];
    const sinRespaldo = (txt, evVals) => numerosDelTexto(txt).filter(x => !(evVals || []).some(v => Math.abs(x - v) <= tolDe(v)) && !extra.some(v => Math.abs(x - v) <= tolDe(v)));
    const fix = h => {
      h = h && typeof h === 'object' ? h : {};
      const v = validateEvidence(h.evidencia, metricas);
      const cat = CATS.indexOf(h.categoria) >= 0 ? h.categoria : 'datos';
      let conf = CONF.indexOf(h.confianza) >= 0 ? h.confianza : 'baja'; let limitada = false;
      if (!ctx.hayBase && conf === 'alta') { conf = 'media'; limitada = true; }
      const r = { titulo: String(h.titulo || '').slice(0, 200), categoria: cat, evidencia: v.ok, interpretacion: String(h.interpretacion || h.por_que || '').slice(0, 900), accion: String(h.accion || '').slice(0, 500), confianza: conf, confianzaLimitada: limitada, idsDesconocidos: v.bad };
      out.idsInventados += v.bad.length;
      const pa = accionPermitida(r.accion, profile); if (pa.ok === false) { if (pa.tipo === 'pilotaje') r.avisoPilotaje = pa.motivo; else r.avisoReglamento = pa.motivo; } else if (pa.ok === 'dudoso') r.avisoLista = pa.motivo;
      const evVals = v.ok.map(e => e.valor); evVals.forEach(x => todaEvidencia.push(x));
      const cs = sinRespaldo(r.titulo + ' ' + r.interpretacion + ' ' + r.accion, evVals); if (cs.length) { r.cifrasSinRespaldo = cs; out.cifrasSinRespaldo += cs.length; }
      const re = CAT_METRICAS[cat]; r.coherente = !re || v.ok.some(e => re.test(e.id));
      if (r.coherente && cat === 'suspension') { // el eje (horquilla / amortiguador) del texto debe ser el de las métricas citadas
        const tx = norm(r.titulo + ' ' + r.interpretacion + ' ' + r.accion), hf = tx.indexOf('horquilla') >= 0, hr = tx.indexOf('amortiguador') >= 0;
        if (hf && !hr && !v.ok.some(e => /\.(susp_f_|vmin$)/.test(e.id))) r.coherente = false;
        if (hr && !hf && !v.ok.some(e => /\.(susp_r_|vmin$)/.test(e.id))) r.coherente = false;
      }
      return r;
    };
    (Array.isArray(j.hallazgos) ? j.hallazgos : []).slice(0, 8).forEach(h => { const r = fix(h); if (!r.evidencia.length) { r.motivoDescarte = 'no cita ninguna métrica real'; out.descartados.push(r); } else if (!r.coherente) { r.motivoDescarte = 'las métricas que cita no corresponden a una conclusión de «' + r.categoria + '»'; out.descartados.push(r); } else out.hallazgos.push(r); });
    if (j.prioridad && typeof j.prioridad === 'object') {
      const v = validateEvidence(j.prioridad.evidencia, metricas); out.idsInventados += v.bad.length;
      out.prioridad = { accion: String(j.prioridad.accion || '').slice(0, 500), por_que: String(j.prioridad.por_que || '').slice(0, 600), evidencia: v.ok, sinRespaldo: v.ok.length === 0 };
      const pa = accionPermitida(out.prioridad.accion, profile); if (pa.ok === false) { if (pa.tipo === 'pilotaje') out.prioridad.avisoPilotaje = pa.motivo; else out.prioridad.avisoReglamento = pa.motivo; } else if (pa.ok === 'dudoso') out.prioridad.avisoLista = pa.motivo;
      const pv = v.ok.map(e => e.valor); pv.forEach(x => todaEvidencia.push(x));
      const cs = sinRespaldo(out.prioridad.accion + ' ' + out.prioridad.por_que, pv); if (cs.length) { out.prioridad.cifrasSinRespaldo = cs; out.cifrasSinRespaldo += cs.length; }
    }
    const csRes = sinRespaldo(out.resumen, todaEvidencia); if (csRes.length) { out.resumenCifrasSinRespaldo = csRes; out.cifrasSinRespaldo += csRes.length; }
    out.no_verificable = (Array.isArray(j.no_verificable) ? j.no_verificable : []).slice(0, 12).map(x => String(x).slice(0, 300));
    out.preguntas_al_piloto = (Array.isArray(j.preguntas_al_piloto) ? j.preguntas_al_piloto : []).slice(0, 8).map(x => String(x).slice(0, 300));
    if (j.__parcial) out.avisos.push('La respuesta de la IA llegó cortada: se muestra solo lo que venía completo.');
    if (out.descartados.length) out.avisos.push(out.descartados.length + ' hallazgo(s) se descartaron (sin métrica real o con métricas que no corresponden a su tema).');
    if (out.idsInventados) out.avisos.push(out.idsInventados + ' referencia(s) a métricas que no existen se descartaron.');
    if (out.hallazgos.some(h => h.evidencia.some(e => e.corregido))) out.avisos.push('Algunas cifras citadas no coincidían con las métricas y se reemplazaron por el valor real.');
    if (out.cifrasSinRespaldo) out.avisos.push(out.cifrasSinRespaldo + ' cifra(s) escritas en el texto no coinciden con las métricas citadas como evidencia en ese mismo punto: no te fíes de ellas.');
    if (out.hallazgos.some(h => h.confianzaLimitada)) out.avisos.push('Sin sesión base la confianza se limita a «media».');
    return out;
  }

  /* --- cuaderno: segunda pasada --- */
  const ESTADOS = ['corroborada', 'contradicha', 'datos_insuficientes', 'no_verificable_con_este_kit'];
  function vocabTexto() { return VOCAB.map(v => '- ' + v.id + ': "' + v.en[0] + '" / "' + v.es[0] + '" → firma: ' + v.firma + ' | sensores: ' + v.sensores.join(', ')).join('\n'); }
  function systemPromptCuaderno(profile) {
    return 'Eres un telemetrista senior. Ya existe un análisis de DATOS (primera pasada). Ahora cruzas lo que dijo el piloto con esos datos, en español neutro, de tú, sin voseo.\n' +
      'Para CADA frase del piloto devuelve un estado: "corroborada" (los datos de la sesión lo respaldan), "contradicha" (las cifras de la sesión muestran lo contrario), "datos_insuficientes" (hay sensores pero no alcanza) o "no_verificable_con_este_kit" (falta el sensor). Cita ids exactos de MÉTRICAS como evidencia cuando el estado sea corroborada o contradicha. No confirmes ni niegues lo que las cifras de sesión no tienen resolución para decidir (una curva o una vuelta concreta, por ejemplo): en ese caso usa "datos_insuficientes". Los estados los revisa el programa. No cambies el análisis de datos.\n' +
      'Vocabulario controlado (úsalo para entender la frase y ligarla a datos):\n' + vocabTexto() + '\n' + reglasDelPerfil(profile) + '\n' +
      'Devuelve SOLO JSON: {"items":[{"id":"id de la frase","es":"traducción al español de la frase (la misma si ya está en español)","vocab":"id del vocabulario o vacío","estado":"corroborada|contradicha|datos_insuficientes|no_verificable_con_este_kit","evidencia":[{"id":"","valor":0}],"comentario":"1-2 frases"}],"sin_mencionar":["hallazgos del análisis de datos que el piloto no mencionó"]}.';
  }
  const RE_ESPECIFICO = /(curva|vuelta|turn|corner|lap|giro|tornante|curva)\s*(n[.º°]?\s*)?\d+|\bT\d{1,2}\b|\bchicane\b|\bhorquilla\s+\d/i;
  // frases: [{id, texto}]; ctx.canales: canales enlazados en el análisis ({gps_speed:true, ...})
  function validateCuaderno(j, frases, metricas, ctx) {
    ctx = ctx || {}; let canales = ctx.canales || null; if (Array.isArray(canales)) { const o = {}; canales.forEach(c => { o[c] = true; }); canales = o; } j = j && typeof j === 'object' ? j : {};
    const ids = new Set(frases.map(f => f.id)); const items = [];
    (Array.isArray(j.items) ? j.items : []).forEach(it => {
      if (!it || !ids.has(it.id)) return; const fr = frases.find(f => f.id === it.id) || {};
      let est = ESTADOS.indexOf(it.estado) >= 0 ? it.estado : 'datos_insuficientes';
      const v = validateEvidence(it.evidencia, metricas);
      let com = String(it.comentario || '').slice(0, 500), fuerza = '', porCodigo = '';
      if ((est === 'corroborada' || est === 'contradicha') && !v.ok.length) est = 'datos_insuficientes';
      // el tipo de frase se decide también en código (no solo lo que diga la IA)
      const vid = VOCAB.some(x => x.id === it.vocab) ? it.vocab : matchVocab(fr.texto || it.es || '');
      const V = VOCAB.find(x => x.id === vid);
      if (V && canales) {
        const falta = V.sensores.filter(sn => !canales[sn]);
        if (V.alguno ? falta.length === V.sensores.length : falta.length > 0) { est = 'no_verificable_con_este_kit'; porCodigo = 'Faltan los sensores necesarios (' + falta.map(sn => CANALES[sn] ? CANALES[sn].label : sn).join(', ') + ').'; }
        else if (V.calc === 'no') { if (est !== 'no_verificable_con_este_kit') est = 'datos_insuficientes'; porCodigo = 'La app no calcula esta señal con los datos de la sesión: solo la IA puede comentarla, no verificarla.'; }
        else {
          if (est === 'contradicha' && (V.calc !== 'sesion' || falta.length > 0)) { est = 'datos_insuficientes'; porCodigo = falta.length ? 'Faltan sensores (' + falta.map(sn => CANALES[sn] ? CANALES[sn].label : sn).join(', ') + '): no se puede contradecir.' : 'Solo hay un indicio: no basta para contradecir al piloto.'; }
          if (est === 'corroborada' && V.calc === 'indicio') fuerza = 'indicio';
        }
      } else if (V && est === 'contradicha') { est = 'datos_insuficientes'; porCodigo = 'Sin información de sensores no se puede contradecir.'; }
      else if (!V && est === 'contradicha') { est = 'datos_insuficientes'; porCodigo = 'La frase no corresponde a una señal que la app calcule: no se puede contradecir.'; }
      // la evidencia tiene que ser del tema de la frase: una cifra cualquiera (p. ej. la velocidad máxima) no respalda ni contradice «toca fondo»
      if ((est === 'corroborada' || est === 'contradicha') && V && V.metricas && !v.ok.some(e => V.metricas.test(e.id))) { est = 'datos_insuficientes'; porCodigo = 'Las cifras citadas no son las que corresponden a esta frase (' + (V.firma || '').slice(0, 90) + '…): no sirven para confirmarla ni contradecirla.'; }
      else if ((est === 'corroborada' || est === 'contradicha') && !V) { est = 'datos_insuficientes'; porCodigo = 'La frase no corresponde a una señal que la app calcule: no se puede confirmar ni contradecir con cifras.'; }
      // a menos de 100 Hz el fondo y la extensión son un mínimo: la ausencia de toques no prueba nada
      if (est === 'contradicha' && V && V.soloFrecuencia && isNum(ctx.hz) && ctx.hz < 100) { est = 'datos_insuficientes'; porCodigo = 'A ' + rnd(ctx.hz, 0) + ' Hz las cifras de fondo y extensión son siempre un mínimo: que no aparezcan toques no contradice al piloto.'; }
      if (est === 'contradicha' && RE_ESPECIFICO.test(fr.texto || '')) { est = 'datos_insuficientes'; porCodigo = 'El piloto habla de una curva o vuelta concreta y las cifras son de toda la sesión.'; }
      if (est === 'corroborada' && RE_ESPECIFICO.test(fr.texto || '') && !fuerza) fuerza = 'indicio';
      if (est === 'no_verificable_con_este_kit' || est === 'datos_insuficientes') { if (est === 'no_verificable_con_este_kit') v.ok.length = 0; }
      items.push({ id: it.id, es: String(it.es || '').slice(0, 500), vocab: V ? V.id : '', estado: est, fuerza, evidencia: est === 'no_verificable_con_este_kit' ? [] : v.ok, comentario: (porCodigo ? '[Revisado por el programa] ' + porCodigo + ' ' : '') + com, porCodigo: !!porCodigo });
    });
    frases.forEach(f => { if (!items.some(x => x.id === f.id)) items.push({ id: f.id, es: '', vocab: '', estado: 'datos_insuficientes', fuerza: '', evidencia: [], comentario: 'La IA no devolvió una evaluación para esta frase.', porCodigo: false }); });
    return { items, sin_mencionar: (Array.isArray(j.sin_mencionar) ? j.sin_mencionar : []).slice(0, 8).map(x => String(x).slice(0, 300)) };
  }

  /* =====================================================================
     8. Bóveda cifrada (cuaderno privado): AES-GCM con clave derivada de una frase.
        Protege el texto contra quien lea el servidor SIN la frase. No protege el texto que se envía a la IA al cruzar.
     ===================================================================== */
  function b64e(buf) { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return btoa(s); }
  function b64d(str) { const s = atob(str); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
  const SUB = () => (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : null;
  const KDF_ITER_NUEVO = 600000, KDF_ITER_MIN = 250000, KDF_ITER_MAX = 5000000;
  const normPass = p => String(p == null ? '' : p).normalize('NFKC').trim();
  function passCheck(pass) { // null = válida; si no, el motivo
    const p = normPass(pass);
    if (p.length < 12) return 'La frase debe tener al menos 12 caracteres (mejor 4 palabras).';
    if (new Set(p.toLowerCase().split('')).size < 6) return 'La frase es demasiado repetitiva: usa al menos 6 caracteres distintos.';
    if (/^\d+$/.test(p)) return 'La frase no puede ser solo números.';
    if (/^(password|contrase|qwerty|asdfgh|123456|abcdef|letmein|admin|ad11)/i.test(p) && p.length < 16) return 'Esa frase es demasiado común: elige otra.';
    return null;
  }
  async function deriveKey(pass, salt, iter) {
    const sub = SUB(); if (!sub) throw new Error('Este navegador no permite cifrar (WebCrypto no disponible). Abre la página por https.');
    const km = await sub.importKey('raw', new TextEncoder().encode(normPass(pass)), 'PBKDF2', false, ['deriveKey']);
    return sub.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  // aad = datos asociados (clave del registro + versión): un registro no se puede cambiar de sitio ni volver a una versión anterior sin que falle
  async function encryptJSON(key, obj, aad) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const par = { name: 'AES-GCM', iv }; if (aad != null) par.additionalData = new TextEncoder().encode(String(aad));
    const ct = await SUB().encrypt(par, key, new TextEncoder().encode(JSON.stringify(obj)));
    return { v: aad != null ? 2 : 1, iv: b64e(iv), ct: b64e(ct) };
  }
  async function decryptJSON(key, blob, aad) {
    const par = { name: 'AES-GCM', iv: b64d(blob.iv) };
    if (blob.v === 2) { if (aad == null) throw new Error('Falta el contexto del registro.'); par.additionalData = new TextEncoder().encode(String(aad)); }
    const pt = await SUB().decrypt(par, key, b64d(blob.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }
  async function vaultCreate(pass) {
    const mal = passCheck(pass); if (mal) throw new Error(mal);
    const salt = crypto.getRandomValues(new Uint8Array(16)); const key = await deriveKey(pass, salt, KDF_ITER_NUEVO);
    const canary = await encryptJSON(key, { ok: 'AD11-CUADERNO' }, 'canary');
    return { key, meta: { v: 2, kdf: 'PBKDF2-SHA256', iter: KDF_ITER_NUEVO, salt: b64e(salt), canary } };
  }
  async function vaultUnlock(pass, meta) {
    const iter = Math.min(KDF_ITER_MAX, Math.max(KDF_ITER_MIN, +meta.iter || KDF_ITER_MIN)); // el servidor no puede rebajar las vueltas por debajo del mínimo
    const key = await deriveKey(pass, b64d(meta.salt), iter);
    try { const c = await decryptJSON(key, meta.canary, meta.canary && meta.canary.v === 2 ? 'canary' : undefined); if (!c || c.ok !== 'AD11-CUADERNO') throw 0; } catch (e) { throw new Error('Frase incorrecta.'); }
    return key;
  }
  // reconstruir la configuración del cuaderno (meta) a partir de la sal guardada junto a una entrada: solo si la frase es la correcta (el llamador lo comprueba descifrando una entrada)
  async function vaultRebuild(pass, saltB64, iter) {
    const mal = passCheck(pass); if (mal) throw new Error(mal);
    const it = Math.min(KDF_ITER_MAX, Math.max(KDF_ITER_MIN, +iter || KDF_ITER_MIN));
    const key = await deriveKey(pass, b64d(saltB64), it);
    const canary = await encryptJSON(key, { ok: 'AD11-CUADERNO' }, 'canary');
    return { key, meta: { v: 2, kdf: 'PBKDF2-SHA256', iter: it, salt: saltB64, canary } };
  }
  async function sha256hex(str) { const d = await SUB().digest('SHA-256', new TextEncoder().encode(str)); return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join(''); }
  async function sha256bytes(buf) { const d = await SUB().digest('SHA-256', buf); return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join(''); }

  return {
    VERSION, CANALES, PERFILES, VOCAB, MDEF, PARAM, ESTADOS, CATS, RANGOS,
    parseTable, autoMap, mapStats, rangoPlausible, suggestConv, buildSeries, segmentLaps, analyze, compareMetrics, comparabilidad, sameCircuit, reglas,
    systemPromptAnalisis, userPayloadAnalisis, parseJSONLoose, validateAnalysis, validateEvidence, accionPermitida, numerosDelTexto, matchVocab,
    systemPromptCuaderno, validateCuaderno, metricLabel, metricUnit,
    vaultCreate, vaultUnlock, vaultRebuild, encryptJSON, decryptJSON, passCheck, sha256hex, sha256bytes,
    _u: { norm, finiteSorted, pctl, movAvg, median, rnd, findApexes, splitLine, toNum, estimateGears }
  };
});
