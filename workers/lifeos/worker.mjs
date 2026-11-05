// The LifeOS Worker on its own Cloudflare account: the owner's Durable Object
// store, the Mac's device API, and the owner OAuth + MCP boundary for ChatGPT.
import { createTaskWorker } from '../../src/tasks-worker.mjs';
import { createCloudTaskService } from '../../src/cloud-task-service.mjs';
import { LifeOSStore, createLifeOSWorker, durableTaskRepository } from '../../src/lifeos-cloud-store.mjs';

export { LifeOSStore };
export default createLifeOSWorker({
  mcp: createTaskWorker({ serviceFactory: env => createCloudTaskService(durableTaskRepository(env)) }),
});
