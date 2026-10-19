import { createTaskWorker } from '../../src/tasks-worker.mjs';
import { createCloudTaskService, createD1TaskRepository } from '../../src/cloud-task-service.mjs';
export default createTaskWorker({ serviceFactory: env => createCloudTaskService(createD1TaskRepository(env.TASKS_DB)) });
