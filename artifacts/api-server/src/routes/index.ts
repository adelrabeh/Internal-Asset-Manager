import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import jobsRouter from "./jobs";
import resultsRouter from "./results";
import uploadsRouter from "./uploads";
import dashboardRouter from "./dashboard";
import usersRouter from "./users";
import auditRouter from "./audit";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(jobsRouter);
router.use(resultsRouter);
router.use(uploadsRouter);
router.use(dashboardRouter);
router.use(usersRouter);
router.use(auditRouter);

export default router;
