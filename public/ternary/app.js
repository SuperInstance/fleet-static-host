// ternary-rom interactive web explainer
// All parsing and interactivity in vanilla JS

const API_BASE = '/data';

// STATE
const state = {
  processes: [],
  cellLibraries: {},
  verilogModules: {},
  lefData: {},
};

// INITIALIZATION
document.addEventListener('DOMContentLoaded', async () => {
  // Check if we can fetch (requires HTTP server)
  try {
    await fetch(`${API_BASE}/cells/sky130.json`);
  } catch (e) {
    document.getElementById('fetchErrorBanner').style.display = 'block';
    return;
  }

  await initializeApp();
});

async function initializeApp() {
  // Load all process libraries
  await loadProcessLibraries();

  // Initialize UI
  initializeExplorer();
  initializeVerilogBrowser();
  initializeLayoutViewer();
  initializeExample();
  initializeCellWidgets();
}

// ========== CELL LIBRARY LOADING & EXPLORER ==========

async function loadProcessLibraries() {
  // List of all 31 processes
  const processes = [
    'generic_180nm', 'generic_22fdsoi', 'generic_28nm', 'generic_40nm', 'generic_65nm', 'generic_90nm',
    'gf12_lp', 'gf14_lpp', 'gf22_fdx', 'gf28_slp', 'gf45_rfsoc',
    'ihp130_sige',
    'intel4', 'intel7', 'intel16', 'intel18a', 'intel22_ffl',
    'samsung5_lpe', 'samsung11_lpp', 'samsung14_lpp', 'samsung28',
    'sky130',
    'smic14', 'smic28',
    'st28_fdsoi',
    'tsmc3', 'tsmc5', 'tsmc7', 'tsmc12', 'tsmc16', 'tsmc28',
  ];

  state.processes = processes;

  // Load each process's cells.json
  for (const proc of processes) {
    try {
      const resp = await fetch(`${API_BASE}/cells/${proc}.json`);
      state.cellLibraries[proc] = await resp.json();
    } catch (e) {
      console.warn(`Failed to load ${proc}:`, e);
    }
  }

  // Populate process selects
  const selects = ['processSelect', 'verilogProcessSelect', 'layoutProcessSelect'];
  for (const id of selects) {
    const elem = document.getElementById(id);
    if (!elem) continue;

    elem.innerHTML = '';
    const grouped = groupProcessesByCategory(processes);
    for (const [category, procs] of Object.entries(grouped)) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = category;
      for (const proc of procs) {
        const opt = document.createElement('option');
        opt.value = proc;
        opt.textContent = proc;
        optgroup.appendChild(opt);
      }
      elem.appendChild(optgroup);
    }
  }

  // Set default selections
  document.getElementById('processSelect').value = 'sky130';
  document.getElementById('verilogProcessSelect').value = 'sky130';
  document.getElementById('layoutProcessSelect').value = 'sky130';
}

function groupProcessesByCategory(processes) {
  const groups = {
    'Open Source': [],
    'Generic (Educational)': [],
    'GlobalFoundries': [],
    'IHP': [],
    'Intel': [],
    'Samsung': [],
    'SMIC': [],
    'ST': [],
    'TSMC': [],
  };

  for (const proc of processes) {
    if (proc === 'sky130') groups['Open Source'].push(proc);
    else if (proc.startsWith('generic_')) groups['Generic (Educational)'].push(proc);
    else if (proc.startsWith('gf')) groups['GlobalFoundries'].push(proc);
    else if (proc.startsWith('ihp')) groups['IHP'].push(proc);
    else if (proc.startsWith('intel')) groups['Intel'].push(proc);
    else if (proc.startsWith('samsung')) groups['Samsung'].push(proc);
    else if (proc.startsWith('smic')) groups['SMIC'].push(proc);
    else if (proc.startsWith('st')) groups['ST'].push(proc);
    else if (proc.startsWith('tsmc')) groups['TSMC'].push(proc);
  }

  return Object.fromEntries(Object.entries(groups).filter(([, v]) => v.length > 0));
}

function initializeExplorer() {
  const select = document.getElementById('processSelect');
  const typeFilter = document.getElementById('cellTypeFilter');
  const vtFilter = document.getElementById('vtFlavorFilter');

  select.addEventListener('change', () => populateCellsTable());
  typeFilter.addEventListener('change', () => populateCellsTable());
  vtFilter.addEventListener('change', () => populateCellsTable());

  populateCellsTable();
}

function populateCellsTable() {
  const process = document.getElementById('processSelect').value;
  const typeFilter = document.getElementById('cellTypeFilter').value;
  const vtFilter = document.getElementById('vtFlavorFilter').value;

  const lib = state.cellLibraries[process];
  if (!lib) {
    document.getElementById('cellsTableBody').innerHTML = '<tr><td colspan="9">No data</td></tr>';
    return;
  }

  // Update summary
  document.getElementById('numCellsChip').textContent = `Cells: ${lib.num_cells}`;
  document.getElementById('voltagechip').textContent = `Voltage: ${lib.voltage}V`;
  document.getElementById('categoryChip').textContent = `Category: ${lib.category}`;

  // Calculate total leakage
  let totalLeakage = 0;
  for (const [name, cell] of Object.entries(lib.cells)) {
    totalLeakage += cell.leakage_pa;
  }
  document.getElementById('leakageChip').textContent = `Total Leakage (all types): ${totalLeakage.toFixed(1)} pA`;

  // Filter and sort cells
  let cells = Object.entries(lib.cells)
    .filter(([name, cell]) => {
      if (typeFilter && cell.type !== typeFilter) return false;
      if (vtFilter && cell.vt_flavor !== vtFilter) return false;
      return true;
    })
    .sort(([a], [b]) => a.localeCompare(b));

  const tbody = document.getElementById('cellsTableBody');
  tbody.innerHTML = cells.map(([name, cell]) => `
    <tr>
      <td>${name}</td>
      <td>${cellTypeLabel(cell.type)}</td>
      <td>${cell.vt_flavor}</td>
      <td>X${cell.drive_strength}</td>
      <td>${cell.width_um.toFixed(2)} × ${cell.height_um.toFixed(2)}</td>
      <td>${cell.area_um2.toFixed(4)}</td>
      <td>${cell.transistors}</td>
      <td>${cell.leakage_pa.toFixed(2)}</td>
      <td>${cell.delay_ns.toFixed(2)}</td>
    </tr>
  `).join('');

  // Update leakage chart
  renderLeakageChart(lib);
}

function cellTypeLabel(type) {
  return { plus: '+ (+1)', minus: '− (−1)', zero: '0 (0)' }[type] || type;
}

function renderLeakageChart(lib) {
  const svg = document.getElementById('leakageChartSvg');
  svg.innerHTML = '';

  const cells = Object.entries(lib.cells)
    .sort(([a], [b]) => a.localeCompare(b));

  const width = 400, height = 150, margin = 40;
  const plotWidth = width - margin * 2;
  const plotHeight = height - margin * 2;

  const maxLeakage = Math.max(...cells.map(([, c]) => c.leakage_pa));
  const scale = plotHeight / maxLeakage;

  cells.forEach(([name, cell], i) => {
    const x = margin + (i / cells.length) * plotWidth;
    const barHeight = cell.leakage_pa * scale;
    const y = height - margin - barHeight;

    const color = { plus: '#4a9eff', minus: '#ff6b4a', zero: '#999' }[cell.type];

    // Bar
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', plotWidth / cells.length * 0.8);
    rect.setAttribute('height', barHeight);
    rect.setAttribute('fill', color);
    rect.setAttribute('opacity', '0.7');
    svg.appendChild(rect);
  });

  // Axes
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', margin);
  line.setAttribute('y1', height - margin);
  line.setAttribute('x2', width - margin);
  line.setAttribute('y2', height - margin);
  line.setAttribute('stroke', '#666');
  line.setAttribute('stroke-width', '1');
  svg.appendChild(line);

  const yaxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  yaxis.setAttribute('x1', margin);
  yaxis.setAttribute('y1', margin);
  yaxis.setAttribute('x2', margin);
  yaxis.setAttribute('y2', height - margin);
  yaxis.setAttribute('stroke', '#666');
  yaxis.setAttribute('stroke-width', '1');
  svg.appendChild(yaxis);
}

// ========== CELL WIDGETS (Interactive Truth Tables) ==========

function initializeCellWidgets() {
  // ROM_PLUS
  document.getElementById('plus-wl').addEventListener('change', (e) => {
    const wl = e.target.checked ? 1 : 0;
    document.getElementById('plus-wl-val').textContent = wl;
    document.getElementById('plus-bl-val').textContent = wl ? 'VDD' : 'Z';
    document.getElementById('plus-indicator').textContent = wl ? '↓' : '→';
  });

  // ROM_MINUS
  document.getElementById('minus-wl').addEventListener('change', (e) => {
    const wl = e.target.checked ? 1 : 0;
    document.getElementById('minus-wl-val').textContent = wl;
    document.getElementById('minus-bl-val').textContent = wl ? 'GND' : 'Z';
    document.getElementById('minus-indicator').textContent = wl ? '↑' : '→';
  });

  // ROM_ZERO (always Z)
  document.getElementById('zero-bl-val').textContent = 'Z';
}

// ========== VERILOG BROWSER ==========

async function initializeVerilogBrowser() {
  const select = document.getElementById('verilogProcessSelect');
  select.addEventListener('change', () => loadVerilog());

  await loadVerilog();
}

async function loadVerilog() {
  const process = document.getElementById('verilogProcessSelect').value;

  try {
    const resp = await fetch(`${API_BASE}/raw/${process}/cells.v`);
    const text = await resp.text();

    state.verilogModules[process] = parseVerilog(text);
    renderVerilogModules(process);
  } catch (e) {
    document.getElementById('moduleList').innerHTML = `<p style="color: #ff6b4a;">Error loading Verilog: ${e.message}</p>`;
  }
}

function parseVerilog(text) {
  const modules = [];
  const regex = /module\s+(\w+)\s*\((.*?)\);([\s\S]*?)endmodule/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const name = match[1];
    const ports = match[2];
    const body = match[3];

    // Parse ports
    const portLines = ports.split(',').map(p => p.trim()).filter(p => p);

    // Find the assign statement
    const assignMatch = body.match(/assign\s+(\w+)\s*=\s*([^;]+);/);
    const assign = assignMatch ? assignMatch[0] : '';

    // Find comments
    const commentMatch = body.match(/\/\/.*\n/g);
    const comments = commentMatch ? commentMatch.map(c => c.trim()) : [];

    modules.push({ name, ports: portLines, assign, comments });
  }

  return modules;
}

function renderVerilogModules(process) {
  const modules = state.verilogModules[process] || [];
  const container = document.getElementById('moduleList');

  container.innerHTML = modules.map((mod, i) => `
    <div class="module">
      <div class="module-header" onclick="this.parentElement.classList.toggle('expanded')">
        <span><code>${mod.name}</code></span>
        <span class="module-toggle">▶</span>
      </div>
      <div class="module-body">
        ${mod.comments.map(c => `<div style="color: #666; font-size: 0.85rem;">${escapeHtml(c)}</div>`).join('')}
        <pre>module ${mod.name} (${mod.ports.join(', ')});
${mod.assign}
endmodule</pre>
      </div>
    </div>
  `).join('');
}

// ========== LEF LAYOUT VIEWER ==========

async function initializeLayoutViewer() {
  const select = document.getElementById('layoutProcessSelect');
  select.addEventListener('change', () => loadLayout());

  await loadLayout();
}

async function loadLayout() {
  const process = document.getElementById('layoutProcessSelect').value;

  try {
    const resp = await fetch(`${API_BASE}/raw/${process}/cells.lef`);
    const text = await resp.text();

    state.lefData[process] = parseLEF(text);
    renderLayout(process);
  } catch (e) {
    document.getElementById('layoutSvg').innerHTML = `<text x="200" y="250" text-anchor="middle" fill="#ff6b4a">Error: ${e.message}</text>`;
  }
}

function parseLEF(text) {
  const macros = [];
  const macroRegex = /MACRO\s+(\w+)([\s\S]*?)END\s+\1/g;
  let match;

  while ((match = macroRegex.exec(text)) !== null) {
    const name = match[1];
    const body = match[2];

    // Parse SIZE
    const sizeMatch = body.match(/SIZE\s+([\d.]+)\s+BY\s+([\d.]+)\s*;/);
    const width = sizeMatch ? parseFloat(sizeMatch[1]) : 0;
    const height = sizeMatch ? parseFloat(sizeMatch[2]) : 0;

    // Parse PINs
    const pins = [];
    const pinRegex = /PIN\s+(\w+)([\s\S]*?)END\s+\1/g;
    let pinMatch;
    while ((pinMatch = pinRegex.exec(body)) !== null) {
      const pinName = pinMatch[1];
      const pinBody = pinMatch[2];

      const dirMatch = pinBody.match(/DIRECTION\s+(\w+)/);
      const direction = dirMatch ? dirMatch[1] : 'SIGNAL';

      const rects = [];
      const rectRegex = /RECT\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s*;/g;
      let rectMatch;
      while ((rectMatch = rectRegex.exec(pinBody)) !== null) {
        rects.push({
          x1: parseFloat(rectMatch[1]),
          y1: parseFloat(rectMatch[2]),
          x2: parseFloat(rectMatch[3]),
          y2: parseFloat(rectMatch[4]),
        });
      }

      const layerMatch = pinBody.match(/LAYER\s+(\w+)/);
      const layer = layerMatch ? layerMatch[1] : 'Metal1';

      pins.push({ name: pinName, direction, layer, rects });
    }

    macros.push({ name, width, height, pins });
  }

  return macros;
}

function renderLayout(process) {
  const macros = state.lefData[process] || [];
  const svg = document.getElementById('layoutSvg');
  svg.innerHTML = '';

  if (macros.length === 0) {
    svg.innerHTML = '<text x="400" y="250" text-anchor="middle" fill="#999">No macros found</text>';
    return;
  }

  const svgNS = 'http://www.w3.org/2000/svg';

  // Scale to fit
  const cellWidth = 80, cellHeight = 80;
  const cols = 4;
  const padding = 20;

  macros.slice(0, 16).forEach((macro, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const offsetX = col * (cellWidth + padding) + 10;
    const offsetY = row * (cellHeight + padding) + 10;

    // Cell background
    const bg = document.createElementNS(svgNS, 'rect');
    bg.setAttribute('x', offsetX);
    bg.setAttribute('y', offsetY);
    bg.setAttribute('width', cellWidth);
    bg.setAttribute('height', cellHeight);
    bg.setAttribute('fill', '#0f1419');
    bg.setAttribute('stroke', '#2a3f5a');
    bg.setAttribute('stroke-width', '1');
    svg.appendChild(bg);

    // Cell name
    const label = document.createElementNS(svgNS, 'text');
    label.setAttribute('x', offsetX + cellWidth / 2);
    label.setAttribute('y', offsetY + 15);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-size', '9');
    label.setAttribute('fill', '#aaa');
    label.textContent = macro.name.substring(0, 15);
    svg.appendChild(label);

    // Pins
    const scale = Math.min(cellWidth / macro.width, cellHeight / macro.height) * 0.8;
    macro.pins.forEach(pin => {
      pin.rects.forEach(rect => {
        const pinRx = (rect.x1 + rect.x2) / 2 * scale;
        const pinRy = (rect.y1 + rect.y2) / 2 * scale;
        const pinW = Math.max(2, (rect.x2 - rect.x1) * scale);
        const pinH = Math.max(2, (rect.y2 - rect.y1) * scale);

        const color = pin.layer === 'Metal2' ? '#4a9eff' : '#1f4788';
        const pinRect = document.createElementNS(svgNS, 'rect');
        pinRect.setAttribute('x', offsetX + 5 + pinRx - pinW / 2);
        pinRect.setAttribute('y', offsetY + 25 + pinRy - pinH / 2);
        pinRect.setAttribute('width', pinW);
        pinRect.setAttribute('height', pinH);
        pinRect.setAttribute('fill', color);
        svg.appendChild(pinRect);
      });
    });
  });
}

// ========== EXAMPLE: 8x8 TERNARY MAC ==========

async function initializeExample() {
  try {
    // Load summary
    const summaryResp = await fetch(`${API_BASE}/example/summary.txt`);
    const summaryText = await summaryResp.text();
    document.getElementById('exampleSummary').innerHTML = `<pre style="margin: 0; font-size: 0.9rem; color: #aaa;">${escapeHtml(summaryText)}</pre>`;

    // Load weight map
    const weightResp = await fetch(`${API_BASE}/example/weight_map.txt`);
    const weightText = await weightResp.text();
    const lines = weightText.trim().split('\n');
    document.getElementById('weightMapDisplay').textContent = lines.join('\n');

    // Count weights
    let plus = 0, minus = 0, zero = 0;
    for (const line of lines) {
      for (const char of line) {
        if (char === '+') plus++;
        else if (char === '-') minus++;
        else if (char === '.') zero++;
      }
    }
    document.getElementById('weightMapInfo').textContent = `ROM_PLUS: ${plus} cells, ROM_MINUS: ${minus} cells, ROM_ZERO: ${zero} cells`;

    // Load netlist
    const netlistResp = await fetch(`${API_BASE}/example/ternary_mac.v`);
    const netlistText = await netlistResp.text();
    const modules = parseVerilog(netlistText);

    const container = document.getElementById('exampleModuleList');
    container.innerHTML = modules.map((mod, i) => `
      <div class="module">
        <div class="module-header" onclick="this.parentElement.classList.toggle('expanded')">
          <span><code>${mod.name}</code></span>
          <span class="module-toggle">▶</span>
        </div>
        <div class="module-body">
          ${mod.comments.map(c => `<div style="color: #666; font-size: 0.85rem;">${escapeHtml(c)}</div>`).join('')}
          <pre>${escapeHtml(mod.assign)}</pre>
        </div>
      </div>
    `).join('');
  } catch (e) {
    console.warn('Error loading example:', e);
  }
}

// ========== UTILITIES ==========

function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return str.replace(/[&<>"']/g, c => map[c]);
}
