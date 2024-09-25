const fsp = require('fs/promises');

const { downloadModels, setupServer, launchServer } = require('./llama');

const main = async () => {
  const workDir = './llamacpp';

  await fsp.mkdir(workDir, { recursive: true });
  await fsp.chmod(workDir, 0o755);

  const onProgress = (report) => console.log(report);
  await setupServer({ workDir, onProgress });
  await downloadModels({ workDir, onProgress });
  const server = await launchServer({ workDir, onProgress });

  console.log(server)
}

main();
