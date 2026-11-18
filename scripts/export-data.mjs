import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

// Cargar credenciales desde service-account.json
const serviceAccountPath = path.resolve(process.cwd(), 'service-account.json');

if (!fs.existsSync(serviceAccountPath)) {
  console.error('❌ Error: No se encontró el archivo service-account.json en la raíz del proyecto.');
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

// Inicializar la aplicación de Firebase Admin
initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

async function exportFirestore() {
  console.log('🚀 Iniciando exportación nativa de Firestore...');
  const exportData = {};

  try {
    // Obtener todas las colecciones principales de la base de datos
    const collections = await db.listCollections();
    console.log(`📁 Encontradas ${collections.length} colecciones principales.`);

    for (const col of collections) {
      const colName = col.id;
      console.log(`⏳ Leyendo colección: ${colName}...`);
      exportData[colName] = {};

      const snapshot = await col.get();
      for (const doc of snapshot.docs) {
        const docId = doc.id;
        exportData[colName][docId] = doc.data();

        // Buscar subcolecciones dentro del documento (ej. users/{uid}/stats_daily)
        const subCollections = await doc.ref.listCollections();
        if (subCollections.length > 0) {
          exportData[colName][docId]._subcollections = {};
          for (const subCol of subCollections) {
            const subColName = subCol.id;
            exportData[colName][docId]._subcollections[subColName] = {};
            
            const subSnapshot = await subCol.get();
            for (const subDoc of subSnapshot.docs) {
              exportData[colName][docId]._subcollections[subColName][subDoc.id] = subDoc.data();
            }
          }
        }
      }
    }

    // Crear carpeta de respaldos si no existe
    const backupDir = path.resolve(process.cwd(), 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = path.join(backupDir, `firestore-backup-${timestamp}.json`);

    fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2), 'utf8');

    console.log(`\n✅ ¡Exportación completada con éxito!`);
    console.log(`📁 Archivo guardado en: ${outputPath}`);

  } catch (error) {
    console.error('❌ Error al exportar los datos:', error);
  }
}

// Llamada correcta a la función
exportFirestore();