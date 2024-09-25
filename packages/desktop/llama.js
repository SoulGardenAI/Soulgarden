const path = require('path');
const { execSync, spawn } = require('child_process');

const EasyDl = require('easydl');
const fsext = require('fs-extra');
const si = require('systeminformation');
const extract = require('extract-zip');

const weights = ['soulgarden-v2.gguf', 'soulgarden-v2-mmproj.gguf'];

const download = async ({ url, output, onProgress }) => {
  const dl = new EasyDl(url, output, {
    connections: 5,
    chunkSize: 100 * 1024 * 1024,
    maxRetry: 10,
    retryDelay: 5 * 1000,
    existBehavior: 'ignore',
  });
  
  dl.on('progress', (report) => {
    const progress = report.total.percentage.toFixed(0);
    const speed = (report.total.speed / 1024).toFixed(2);
    const bytes = (report.total.bytes / (1024 * 1024)).toFixed(2);

    onProgress?.({ progress, speed, bytes });
  });
  
  dl.on('error', (err) => {
    throw new Error(`Error downloading ${url}: ${err}`, err)
  });
  
  await dl.wait();
}

const downloadModels = async ({ workDir, onProgress }) => { 
  for (let weight of weights) {

    const url = `https://huggingface.co/soulgarden/models/resolve/main/${weight}`;
    const output = path.join(workDir, weight);
    const log = `Downloading ${weight === 'soulgarden-v2.gguf' ? 'model' : 'projector'}`;

    await download({ url, output, onProgress: (report) => {
      onProgress?.({ ...report, log });
    }});
  }
};

const setupServer = async ({ workDir, onProgress } = {}) => {
  const  { arch, platform } = process;

  const version = 'b2356'
  let url;

  if (platform === 'linux')
    throw new Error('Unsupported platform');
  
  if (platform === 'win32') {
    const getCudaVersion = () => {
      try {
        const output = execSync('nvcc --version').toString();
        const versionMatch = output.match(/release (\d+\.\d+)/);
        if (versionMatch) {
          return versionMatch[1];
        }
      } catch (error) {}

      return null;
    }
  
    const isVulkanAvailable = () => {
      try {
        execSync('vulkaninfo');
        return true;
      } catch (error) {}

      return false;
    }

    const { flags } = await si.cpu();

    let backend = 'noavx';
    if (flags.includes('avx512')) {
      backend = 'avx512';
    } else if (flags.includes('avx2')) {
      backend = 'avx2';
    } else if (flags.includes('avx')) {
      backend = 'avx';
    }

    const cudaVersion = getCudaVersion();
    if (cudaVersion === '11.7') {
      backend = 'cublas-cu11.7.1';
    } else if (cudaVersion === '12.2') {
      backend = 'cublas-cu12.2.0';
    } else if (isVulkanAvailable()) {
      backend = 'vulkan';
    } else if (flags.includes('openblas')) {
      backend = 'openblas';
    } else if (flags.includes('kompute')) {
      backend = 'kompute';
    }

    const binary = `llama-${version}-bin-win-${backend}-${arch}`;
    url = `https://github.com/ggerganov/llama.cpp/releases/download/${version}/${binary}.zip`;
  } 
  
  if (platform === 'darwin') {
    if (arch === 'x64') throw new Error('Unsupported MacOS architecture');

    const binary = `llama-${version}-bin-macos-${arch}`;
    url = `https://github.com/SoulGardenAI/Soulgarden/releases/download/llama/${binary}.zip`;
  }

  const output = path.join(workDir, 'server.zip');
  let log = `Downloading llama.cpp`;
  await download({ url, output, onProgress: (report) => {
    onProgress?.({ ...report, log });
  }});

  log = `Installing llama.cpp`;
  onProgress?.({ log });
  await extract(output, { dir: path.resolve(workDir) });
}
 
let server;
const launchServer = async ({ workDir, context = 8192, port = 9697, logger = console }) => {
  const { platform } = process;
  
  const binary = platform === 'win32' ? 'server.exe' : 'server';
  const binaryPath = path.join(workDir, binary);
  
  const exists = await fsext.pathExists(binaryPath);
  if (!exists) 
    throw new Error(`Server binary not found at ${binaryPath}`);

  server = spawn(binaryPath, [
      '--mmproj', `${path.resolve(workDir)}/${weights[1]}`,
      '-m', `${path.resolve(workDir)}/${weights[0]}`,
      '-c', context,
      '--port', port
    ], {
      cwd: process.cwd(),
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );

  server.stdout.on('data', (data) => logger.info(`Server: ${data}`));
  server.stderr.on('data', (data) => logger.info(`Server: ${data}`));

  server.on('close', (code) => {
    setTimeout(async () => {
      logger.error(`Server closed with code ${code}. Restarting...`);
      await launchServer({ workDir, context, port, logger });
    }, 2 * 1000);
  });

  return server;
}

exports.launchServer = launchServer;
exports.setupServer = setupServer;
exports.downloadModels = downloadModels;
