import { Events } from "discord.js";
import { logger, startupLog } from "../utils/logger.js";
import config from "../config/application.js";
import { reconcileReactionRoleMessages } from "../services/reactionRoleService.js";
import { checkBirthdays } from "../services/birthdayService.js"; // <-- Added import

export default {
  name: Events.ClientReady,
  once: true,

  async execute(client) {
    try {
      client.user.setPresence(config.bot.presence);

      startupLog(`Ready! Logged in as ${client.user.tag}`);
      startupLog(`Serving ${client.guilds.cache.size} guild(s)`);
      startupLog(`Loaded ${client.commands.size} commands`);

      const reconciliationSummary = await reconcileReactionRoleMessages(client);
      startupLog(
        `Reaction role reconciliation: scanned ${reconciliationSummary.scannedMessages}, removed ${reconciliationSummary.removedMessages}, errors ${reconciliationSummary.errors}`
      );

      // --- START OF BIRTHDAY LOOP ---
      startupLog("Initializing timezone-aware birthday role engine...");
      
      // Run the check immediately so it catches anyone whose birthday is right now when the bot boots up
      await checkBirthdays(client).catch(err => logger.error("Initial birthday check failed:", err));

      // Set a timer to automatically repeat the check every 30 minutes
      setInterval(async () => {
        try {
          await checkBirthdays(client);
        } catch (error) {
          logger.error("Error in scheduled birthday interval check:", error);
        }
      }, 30 * 60 * 1000); 
      // --- END OF BIRTHDAY LOOP ---

    } catch (error) {
      logger.error("Error in ready event:", error);
    }
  },
};
