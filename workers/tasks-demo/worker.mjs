import { createTaskWorker } from '../../src/tasks-worker.mjs';
import { createDemoTaskService } from './demo-tasks.mjs';
export default createTaskWorker({ serviceFactory: () => createDemoTaskService(), demo: true });
