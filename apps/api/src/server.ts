import "dotenv/config";
import { app } from "./app.js";

const port = Number(process.env.API_PORT ?? 3000);

app.listen(port, "0.0.0.0", () => {
  console.log(`MiniWallet API listening on port ${port}`);
});
