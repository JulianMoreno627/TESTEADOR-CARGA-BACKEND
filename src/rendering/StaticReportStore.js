import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Generación estática bajo demanda (SSG): cada archivo se construye la primera
 * vez que se pide y después se sirve desde disco, sin consultar la base de datos.
 */
export class StaticReportStore {
  #directory;
  #building = new Map();

  constructor(directory) {
    this.#directory = directory;
  }

  async ensure(fileName, build) {
    const filePath = path.join(this.#directory, fileName);
    if (await this.#exists(filePath)) return filePath;

    // Dos visitas simultáneas comparten la misma generación.
    if (!this.#building.has(fileName)) {
      const building = this.#write(filePath, build).finally(() => this.#building.delete(fileName));
      this.#building.set(fileName, building);
    }
    await this.#building.get(fileName);
    return filePath;
  }

  async remove(fileName) {
    await rm(path.join(this.#directory, fileName), { force: true });
  }

  async #write(filePath, build) {
    const content = await build();
    await mkdir(this.#directory, { recursive: true });
    // Renombrar al final evita servir un archivo a medio escribir.
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, content);
    await rename(temporaryPath, filePath);
  }

  async #exists(filePath) {
    try {
      await stat(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
