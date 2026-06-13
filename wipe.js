import { getLevelingConfig, saveLevelingConfig } from './services/leveling.js'; 
// NOTE: If your services folder is in a different directory, adjust the path above!

// Dummy client object to satisfy your service functions
const dummyClient = {}; 
const targetGuildId = '1362454274499547187';

async function runWipe() {
    console.log("Connecting to database configuration...");
    try {
        const cfg = await getLevelingConfig(dummyClient, targetGuildId);
        
        if (!cfg) {
            console.error("❌ ERROR: Could not find a leveling configuration for this server ID.");
            process.exit(1);
        }

        // Force reset the array
        cfg.ignoredChannels = []; 
        
        await saveLevelingConfig(dummyClient, targetGuildId, cfg);
        
        console.log("\n=========================================================");
        console.log("✅ SUCCESS: Your dashboard channel list is now 100% EMPTY!");
        console.log("=========================================================\n");
        process.exit(0);
    } catch (error) {
        console.error("❌ DATABASE ERROR:", error);
        process.exit(1);
    }
}

runWipe();
