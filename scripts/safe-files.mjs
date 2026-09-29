import fs from "node:fs";

const NO_FOLLOW = fs.constants.O_NOFOLLOW ?? 0;

function openRegularFileSync(filePath, { writable = false, createIfMissing = false, exclusive = false } = {}) {
  const access = writable ? fs.constants.O_WRONLY : fs.constants.O_RDONLY;
  let descriptor;

  if (exclusive) {
    descriptor = fs.openSync(
      filePath,
      access | fs.constants.O_CREAT | fs.constants.O_EXCL | NO_FOLLOW,
      0o666,
    );
  } else {
    try {
      descriptor = fs.openSync(filePath, access | NO_FOLLOW);
    } catch (error) {
      if (!createIfMissing || error.code !== "ENOENT") throw error;
      descriptor = fs.openSync(
        filePath,
        access | fs.constants.O_CREAT | fs.constants.O_EXCL | NO_FOLLOW,
        0o666,
      );
    }
  }

  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile()) throw new Error(`refusing non-regular file: ${filePath}`);

    // Windows does not expose O_NOFOLLOW. Check the opened handle against the
    // current directory entry before any read or write uses that handle.
    if (fs.constants.O_NOFOLLOW === undefined) {
      const named = fs.lstatSync(filePath, { bigint: true });
      if (
        !named.isFile()
        || named.isSymbolicLink()
        || named.dev !== opened.dev
        || named.ino !== opened.ino
      ) {
        throw new Error(`refusing changed or symbolic-link file: ${filePath}`);
      }
    }
    return descriptor;
  } catch (error) {
    try {
      fs.closeSync(descriptor);
    } catch {
      // Preserve the validation error.
    }
    throw error;
  }
}

export function readRegularFileSync(filePath, encoding) {
  const descriptor = openRegularFileSync(filePath);
  try {
    return encoding
      ? fs.readFileSync(descriptor, { encoding })
      : fs.readFileSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

export function writeRegularFileSync(filePath, contents, { exclusive = false } = {}) {
  const descriptor = openRegularFileSync(filePath, {
    writable: true,
    createIfMissing: !exclusive,
    exclusive,
  });
  try {
    fs.ftruncateSync(descriptor, 0);
    if (typeof contents === "string") fs.writeFileSync(descriptor, contents, "utf8");
    else fs.writeFileSync(descriptor, contents);
  } finally {
    fs.closeSync(descriptor);
  }
}
