import type { FastifyInstance } from "fastify";
import type { WorldRecordService } from "./world-record-service.js";

export async function registerWorldRecordRoutes(app: FastifyInstance, service: Pick<WorldRecordService, "list">): Promise<void> {
  app.get("/v1/public/world-records", async (_request, reply) => {
    try { return { schemaVersion: "mk8dx.world-records.v1", records: await service.list() }; }
    catch { return reply.code(503).send({ code: "world_records_unavailable", message: "World Records are temporarily unavailable." }); }
  });
}
