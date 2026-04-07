import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import jobsRouter from "./jobs";
import resultsRouter from "./results";
import uploadsRouter from "./uploads";
import dashboardRouter from "./dashboard";
import usersRouter from "./users";
import auditRouter from "./audit";
import notificationsRouter from "./notifications";
import searchRouter from "./search";
import statsRouter from "./stats";
import apiKeysRouter from "./api-keys";
import { apiKeyAuth } from "./api-keys";
import { projectsRouter } from "./projects";

const router: IRouter = Router();

// API key bearer token authentication (runs before all routes)
router.use(apiKeyAuth);

router.use(healthRouter);
router.use(authRouter);
router.use(jobsRouter);
router.use(resultsRouter);
router.use(uploadsRouter);
router.use(dashboardRouter);
router.use(usersRouter);
router.use(auditRouter);
router.use(notificationsRouter);
router.use(searchRouter);
router.use(statsRouter);
router.use(apiKeysRouter);
router.use(projectsRouter);

export default router;
