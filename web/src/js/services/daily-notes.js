/* =========================================================
   Daily notes: one per day in daily notes/, named YYYY-MM-DD (services/folders.js).
   ========================================================= */
import { formatMoment } from "../core/dates.js";
import { DAILY, DAILY_FORMAT, vaultFolder } from "./folders.js";

/** The path of the daily note for `date` (today by default). */
export const dailyNotePath = (date = new Date()) => vaultFolder(DAILY) + "/" + formatMoment(date, DAILY_FORMAT) + ".md";
