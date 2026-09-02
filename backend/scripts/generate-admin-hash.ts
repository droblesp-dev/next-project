import bcrypt from 'bcryptjs';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import path from 'path';

const SECRETS_DIR = path.resolve('.local-secrets');
const INPUT_PATH = path.join(SECRETS_DIR, 'admin-password.txt');
const OUTPUT_PATH = path.join(SECRETS_DIR, 'admin-password-hash.txt');
const SALT_ROUNDS = 12;

async function main() {
  if (!existsSync(INPUT_PATH)) {
    console.error(
      `No se encontró el archivo de contraseña local. Creá el archivo:\n${INPUT_PATH}\ncon la contraseña en texto plano como único contenido, y volvé a ejecutar este script.`
    );
    process.exit(1);
  }

  const password = readFileSync(INPUT_PATH, 'utf-8').trim();

  if (!password) {
    console.error('El archivo de contraseña local está vacío.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, SALT_ROUNDS);

  writeFileSync(OUTPUT_PATH, hash, 'utf-8');
  unlinkSync(INPUT_PATH);

  console.log('Hash bcrypt generado correctamente y guardado localmente.');
  console.log(`Archivo de salida: ${OUTPUT_PATH}`);
  console.log('El archivo de contraseña en texto plano fue eliminado.');
}

main().catch((error) => {
  console.error('Error al generar el hash:', (error as Error).message);
  process.exit(1);
});
