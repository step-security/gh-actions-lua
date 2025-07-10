const core = require("@actions/core");
const axios = require('axios');
const exec = require("@actions/exec");
const io = require("@actions/io");
const tc = require("@actions/tool-cache");
const ch = require("@actions/cache");
const fs = require("fs").promises;
const path = require("path");

async function validateSubscription() {
  const API_URL = `https://agent.api.stepsecurity.io/v1/github/${process.env.GITHUB_REPOSITORY}/actions/subscription`;

  try {
    await axios.get(API_URL, {timeout: 3000});
  } catch (error) {
    if (error.response) {
      console.error(
        'Subscription is not valid. Reach out to support@stepsecurity.io'
      );
      process.exit(1);
    } else {
      core.info('Timeout or API not reachable. Continuing to next step.');
    }
  }
}

const LUA_BUILD_DIR = ".lua-build";
const LUA_INSTALL_DIR = ".lua";

const LUA_VERSIONS = {
  "5.1": "5.1.5",
  "5.2": "5.2.4", 
  "5.3": "5.3.6",
  "5.4": "5.4.7",
  "luajit": "luajit-2.1"
};

const LUAJIT_CONFIG = {
  "luajit-2.0": { url: "https://github.com/luajit/luajit.git", branch: "v2.0", binary: "luajit" },
  "luajit-2.1": { url: "https://github.com/luajit/luajit.git", branch: "v2.1", binary: "luajit" },
  "luajit-2.1.0-beta3": { url: "https://github.com/luajit/luajit.git", branch: "v2.1.0-beta3", binary: "luajit-2.1.0-beta3" },
  "luajit-master": { url: "https://github.com/luajit/luajit.git", branch: "master", binary: "luajit" },
  "luajit-openresty": { url: "https://github.com/openresty/luajit2.git", branch: "v2.1-agentzh", binary: "luajit" }
};

function getOperatingSystem() {
  const platform = process.platform;
  return {
    isWindows: platform.startsWith("win32"),
    isMacOS: platform.startsWith("darwin"),
    isLinux: platform === "linux"
  };
}

function createPosixPath(...segments) {
  return path.posix.join(...segments);
}

function getCurrentDirectory() {
  return process.cwd().split(path.sep).join(path.posix.sep);
}

async function checkFileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function logMessage(message) {
  core.notice(`gh-actions-lua: ${message}`);
}

function logWarning(message) {
  core.warning(`gh-actions-lua: ${message}`);
}

async function setupLuaJITSymlinks(sourceDir, installDir, binaryName) {
  const os = getOperatingSystem();
  const binDir = createPosixPath(installDir, "bin");
  
  if (os.isWindows) {
    await fs.copyFile(
      createPosixPath(sourceDir, "lua51.dll"),
      createPosixPath(installDir, "bin", "lua51.dll")
    );
    await fs.copyFile(
      createPosixPath(sourceDir, "lua51.dll"),
      createPosixPath(installDir, "lib", "lua51.dll")
    );
    await exec.exec(`ln -s ${binaryName} lua.exe`, undefined, { cwd: binDir });
  } else {
    await exec.exec(`ln -s ${binaryName} lua`, undefined, { cwd: binDir });
  }
}

async function buildLuaJIT(installPath, version) {
  const versionKey = version.substring("luajit-".length);
  let config = LUAJIT_CONFIG[version];
  
  if (!config) {
    config = {
      url: LUAJIT_CONFIG["luajit-master"].url,
      branch: `v${versionKey}`,
      binary: "luajit"
    };
  }

  const buildDir = path.join(process.env.RUNNER_TEMP, LUA_BUILD_DIR);
  const compileFlags = core.getInput('luaCompileFlags');
  const repoName = config.url.match(/.*\/(.*)\.git/)[1];

  await io.mkdirP(buildDir);
  await exec.exec(`git clone --branch ${config.branch} --single-branch ${config.url}`, undefined, {
    cwd: buildDir
  });

  const os = getOperatingSystem();
  let makeFlags = "-j";
  
  if (os.isMacOS) {
    makeFlags += " MACOSX_DEPLOYMENT_TARGET=10.15";
  }
  
  if (compileFlags) {
    makeFlags += ` ${compileFlags}`;
  }

  const projectDir = createPosixPath(buildDir, repoName);
  await exec.exec(`make ${makeFlags}`, undefined, {
    cwd: projectDir,
    ...(os.isWindows ? { env: { SHELL: 'cmd' } } : {})
  });

  await exec.exec(`make -j install PREFIX="${installPath}"`, undefined, {
    cwd: projectDir
  });

  await setupLuaJITSymlinks(
    createPosixPath(projectDir, "src"),
    installPath,
    config.binary
  );
}

async function linkWithManifest(workDir, linkCommand, outputFile, objectFiles) {
  await exec.exec(`${linkCommand} /out:${outputFile}`, objectFiles, { cwd: workDir });
  
  const manifestFile = `${outputFile}.manifest`;
  if (await checkFileExists(manifestFile)) {
    await exec.exec("mt /nologo", ["-manifest", manifestFile, `-outputresource:${outputFile}`], {
      cwd: workDir
    });
  }
}

async function copyFiles(targetDir, sourceDir, fileList) {
  await io.mkdirP(targetDir);
  for (const file of fileList) {
    const fileName = path.posix.basename(file);
    await fs.copyFile(createPosixPath(sourceDir, file), createPosixPath(targetDir, fileName));
  }
}

async function buildLuaWindows(extractPath, installPath, version) {
  const compileFlags = core.getInput('luaCompileFlags');
  const compiler = "cl /nologo /MD /O2 /W3 /c /D_CRT_SECURE_NO_DEPRECATE";
  
  const compiledObjects = {
    lib: [],
    lua: [],
    luac: []
  };

  const sourceFiles = {
    lua: ["lua.c"],
    luac: ["luac.c", "print.c"]
  };

  const sourceDir = createPosixPath(extractPath, "src");
  const files = await fs.readdir(sourceDir);

  for (const file of files) {
    if (file.endsWith(".c")) {
      let category = "lib";
      if (sourceFiles.lua.includes(file)) category = "lua";
      else if (sourceFiles.luac.includes(file)) category = "luac";

      const sourcePath = createPosixPath("src", file);
      const compilerArgs = category === "lib" 
        ? ["-DLUA_BUILD_AS_DLL", sourcePath]
        : [sourcePath];

      compiledObjects[category].push(file.replace(".c", ".obj"));
      await exec.exec(compiler, compilerArgs, { cwd: extractPath });
    }
  }

  const versionParts = version.split(".");
  const libFile = `lua${versionParts[0]}${versionParts[1]}.lib`;
  const dllFile = `lua${versionParts[0]}${versionParts[1]}.dll`;

  compiledObjects.lua = [...compiledObjects.lua, libFile];
  compiledObjects.luac = [...compiledObjects.luac, ...compiledObjects.lib];

  await linkWithManifest(extractPath, "link /nologo /DLL", dllFile, compiledObjects.lib);
  await linkWithManifest(extractPath, "link /nologo", "luac.exe", compiledObjects.luac);
  await linkWithManifest(extractPath, "link /nologo", "lua.exe", compiledObjects.lua);

  const headerFile = await checkFileExists(createPosixPath(sourceDir, "lua.hpp")) ? "lua.hpp" : "../etc/lua.hpp";
  const headers = ["lua.h", "luaconf.h", "lualib.h", "lauxlib.h", headerFile];

  await copyFiles(createPosixPath(installPath, "bin"), extractPath, ["lua.exe", "luac.exe", dllFile]);
  await copyFiles(createPosixPath(installPath, "lib"), extractPath, [dllFile, libFile]);
  await copyFiles(createPosixPath(installPath, "include"), sourceDir, headers);
}

async function buildStandardLua(installPath, version) {
  const extractPath = createPosixPath(process.env.RUNNER_TEMP, LUA_BUILD_DIR, `lua-${version}`);
  const compileFlags = core.getInput('luaCompileFlags');

  const sourceArchive = await tc.downloadTool(`https://lua.org/ftp/lua-${version}.tar.gz`);
  await io.mkdirP(extractPath);
  await tc.extractTar(sourceArchive, path.join(process.env.RUNNER_TEMP, LUA_BUILD_DIR));

  const os = getOperatingSystem();
  
  if (os.isWindows) {
    return await buildLuaWindows(extractPath, installPath, version);
  }

  if (os.isMacOS) {
    await exec.exec("brew install readline ncurses");
  } else {
    await exec.exec("sudo apt-get install -q libreadline-dev libncurses-dev", undefined, {
      env: { DEBIAN_FRONTEND: "noninteractive", TERM: "linux" }
    });
  }

  let makeCommand = `-j ${os.isMacOS ? "macosx" : "linux"}`;
  if (compileFlags) {
    makeCommand += ` ${compileFlags}`;
  }

  await exec.exec(`make ${makeCommand}`, undefined, { cwd: extractPath });
  await exec.exec(`make -j INSTALL_TOP="${installPath}" install`, undefined, { cwd: extractPath });
}

async function installLua(installPath, version) {
  if (version.startsWith("luajit-")) {
    return await buildLuaJIT(installPath, version);
  }
  return await buildStandardLua(installPath, version);
}

function generateCacheKey(version, flags) {
  return `lua:${version}:${process.platform}:${process.arch}:${flags}`;
}

async function main() {
  await validateSubscription();

  let requestedVersion = core.getInput('luaVersion', { required: true });
  
  if (LUA_VERSIONS[requestedVersion]) {
    requestedVersion = LUA_VERSIONS[requestedVersion];
  }

  const installPath = createPosixPath(getCurrentDirectory(), LUA_INSTALL_DIR);
  let cachedToolDir = tc.find('lua', requestedVersion);

  if (!cachedToolDir) {
    const cacheKey = generateCacheKey(requestedVersion, core.getInput('luaCompileFlags') || "");
    
    if (core.getInput('buildCache') === 'true') {
      const restoredCache = await ch.restoreCache([installPath], cacheKey);
      if (restoredCache) {
        logMessage(`Cache restored: ${restoredCache}`);
      } else {
        logMessage("No cache available, performing clean build");
      }
    }

    if (!(await checkFileExists(installPath))) {
      await installLua(installPath, requestedVersion);
      try {
        logMessage(`Storing into cache: ${cacheKey}`);
        await ch.saveCache([installPath], cacheKey);
      } catch (error) {
        logWarning(`Failed to save to cache (continuing anyway): ${error}`);
      }
    }

    cachedToolDir = await tc.cacheDir(installPath, 'lua', requestedVersion);
  }

  if (cachedToolDir && !(await checkFileExists(installPath))) {
    await fs.symlink(cachedToolDir, installPath);
  }

  core.addPath(createPosixPath(installPath, "bin"));
  process.exit();
}

main().catch(error => {
  core.setFailed(`Failed to install Lua: ${error}`);
});