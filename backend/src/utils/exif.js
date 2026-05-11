import sharp from 'sharp';

// Extrait DateTimeOriginal depuis le buffer EXIF brut via regex
// Format EXIF : "YYYY:MM:DD HH:MM:SS"
export async function extractTakenAt(filePath) {
  try {
    const meta = await sharp(filePath).metadata();
    if (!meta.exif) return null;

    const str = meta.exif.toString('binary');
    const match = str.match(/(\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2})/);
    if (!match) return null;

    // Convertir "2026:05:05 18:22:02" → timestamp Unix
    const [datePart, timePart] = match[1].split(' ');
    const iso = `${datePart.replace(/:/g, '-')}T${timePart}`;
    const ts = Math.floor(new Date(iso).getTime() / 1000);
    return isNaN(ts) ? null : ts;
  } catch {
    return null;
  }
}
