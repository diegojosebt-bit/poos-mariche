import fs from 'fs';
import path from 'path';

const SRC_DIR = path.resolve(process.cwd(), 'src');
const OUTPUT_FILE = path.resolve(process.cwd(), 'ARCHITECTURE_MAP.md');

function getAllFiles(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      getAllFiles(fullPath, fileList);
    } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

function analyzeProject() {
  const allFiles = getAllFiles(SRC_DIR);
  const pages = [];
  const collectionUsages = {};
  const contexts = [];
  const keyComponents = [];

  const rel = (p) => path.relative(process.cwd(), p).replace(/\\/g, '/');

  for (const file of allFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const relativePath = rel(file);

    // 1. Pages detection
    if (relativePath.includes('src/app/') && relativePath.endsWith('page.tsx')) {
      const route = relativePath
        .replace('src/app', '')
        .replace('/page.tsx', '') || '/';
      
      const securityGateMatch = content.match(/SecurityGate\s+module="([^"]+)"/);
      const securityGate = securityGateMatch ? securityGateMatch[1] : 'Ninguno (Público/General)';

      // Detect firestore queries inside page
      const queryMatches = [...content.matchAll(/collection\([^,]+,\s*[^,]+,\s*(?:user\.uid|userId|[^,]+),\s*['"]([^'"]+)['"]/g)]
        .map(m => m[1]);

      pages.push({
        route,
        file: relativePath,
        securityGate,
        collections: [...new Set(queryMatches)]
      });
    }

    // 2. Collection detections across all files
    const colMatches = [...content.matchAll(/['"](?:users\/[^/]+\/)?([a-zA-Z0-9_-]+)['"]/g)];
    const knownCollections = [
      'products', 'repair_jobs', 'sale_transactions', 'held_sales', 
      'fiados', 'currency_exchanges', 'expenses', 'metadata', 'workers', 'roles_admin'
    ];

    for (const known of knownCollections) {
      const regex = new RegExp(`['"]${known}['"]`, 'g');
      if (regex.test(content)) {
        if (!collectionUsages[known]) collectionUsages[known] = [];
        collectionUsages[known].push(relativePath);
      }
    }

    // 3. Contexts
    if (relativePath.includes('src/contexts/')) {
      contexts.push(relativePath);
    }

    // 4. Main components
    if (relativePath.includes('src/components/') && !relativePath.includes('/ui/')) {
      keyComponents.push(relativePath);
    }
  }

  // Generate Markdown
  let md = `# MAPA DE ARQUITECTURA DEL SISTEMA (Cero Consumo de Tokens)\n\n`;
  md += `> **Generado automáticamente:** ${new Date().toISOString()}\n`;
  md += `> Este archivo es una referencia ultracompacta para auditorías rápidas de la IA sin tener que leer archivos pesados de UI.\n\n`;

  md += `## 1. Rutas y Pantallas de la Aplicación\n\n`;
  md += `| Ruta | Módulo / Seguridad | Colecciones Consultadas | Archivo |\n`;
  md += `| :--- | :--- | :--- | :--- |\n`;
  for (const p of pages.sort((a, b) => a.route.localeCompare(b.route))) {
    const cols = p.collections.length ? p.collections.map(c => `\`${c}\``).join(', ') : '_Ninguna_';
    md += `| **${p.route}** | \`${p.securityGate}\` | ${cols} | \`${p.file}\` |\n`;
  }

  md += `\n## 2. Mapa de Colecciones Firestore y Estrategia de Lecturas\n\n`;
  md += `| Colección | Estrategia de Costo | Archivos Principales que la Usan |\n`;
  md += `| :--- | :--- | :--- |\n`;

  const strategyMap = {
    products: 'Catálogo completo en RAM (0ms, 0 lecturas tras carga inicial)',
    sale_transactions: 'Límite estricto 50 + Paginación servidor (Blindaje)',
    repair_jobs: 'Límite 100 recientes + Filtro activo/garantía en RAM',
    held_sales: 'Tiempo real / Subcolección de ventas en espera',
    fiados: 'Carga bajo demanda en pestaña Fiados / RAM',
    currency_exchanges: 'Carga bajo demanda en arqueo de caja / RAM',
    expenses: 'Carga por rango de fechas en gastos / RAM',
    metadata: 'Documentos guardián y estados del negocio',
    roles_admin: 'Validación de roles administrativos',
    workers: 'Gestión de personal y técnicos'
  };

  for (const [col, files] of Object.entries(collectionUsages)) {
    const strat = strategyMap[col] || 'Estándar';
    const topFiles = files.slice(0, 4).map(f => {
      const parts = f.split('/');
      return `\`${parts.slice(-2).join('/')}\``;
    }).join(', ');
    const more = files.length > 4 ? ` (+${files.length - 4} más)` : '';
    md += `| \`${col}\` | **${strat}** | ${topFiles}${more} |\n`;
  }

  md += `\n## 3. Estado Global y Caché en Memoria (RAM)\n\n`;
  md += `- **\`src/contexts/dashboard-context.tsx\`**:\n`;
  md += `  - \`dataCache\`: Almacén global que retiene colecciones completas en memoria para evitar re-consultas entre pantallas (POS, Inventario, Reportes).\n`;
  md += `  - \`addItemToCache\`, \`updateCachedItem\`, \`removeCachedItem\`: Mutaciones optimistas en 0ms.\n`;
  md += `- **\`src/firebase/firestore/use-collection.tsx\`**:\n`;
  md += `  - Hook principal que alimenta las pantallas. Consulta la memoria RAM (\`dataCache\`) primero y solo va al servidor cuando no existe el dato o se fuerza con \`refetch()\`. Purga claves obsoletas de sincronización local.\n`;

  md += `\n## 4. Componentes Clave por Módulo\n\n`;
  const moduleGroups = {
    'POS / Caja': keyComponents.filter(c => c.includes('/pos/')),
    'Inventario': keyComponents.filter(c => c.includes('/inventory/')),
    'Reparaciones': keyComponents.filter(c => c.includes('/repairs/')),
    'Reportes / Arqueo': keyComponents.filter(c => c.includes('/reports/')),
    'Seguridad y Auth': keyComponents.filter(c => c.includes('security') || c.includes('auth') || c.includes('lock')),
  };

  for (const [mod, files] of Object.entries(moduleGroups)) {
    md += `### ${mod}\n`;
    for (const f of files) {
      md += `- \`${f}\`\n`;
    }
    md += `\n`;
  }

  md += `## 5. Instrucciones de Búsqueda Quirúrgica (CLI) para la IA\n\n`;
  md += `Para evitar leer archivos completos, la IA debe preferir:\n`;
  md += `\`\`\`bash\n`;
  md += `# Buscar dónde se llama una función o colección:\n`;
  md += `grep -rn "collectionName" src/\n\n`;
  md += `# Ver solo las líneas de la consulta Firestore en un archivo:\n`;
  md += `grep -n -C 3 "collection(" src/app/dashboard/pos/page.tsx\n\n`;
  md += `# Regenerar este mapa en cualquier momento:\n`;
  md += `npm run map\n`;
  md += `\`\`\`\n`;

  fs.writeFileSync(OUTPUT_FILE, md, 'utf8');
  console.log(`[MAPA GENERADO]: ${OUTPUT_FILE}`);
}

analyzeProject();
