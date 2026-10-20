import fs from "node:fs";
import { analyze } from "../src/lib/verify";
const { doc } = await analyze(fs.readFileSync(process.argv[2]), process.argv[2]);
for (const pg of doc.pages ?? []) console.log(pg.number, pg.pageNumber ? pg.pageNumber.text + "@" + pg.pageNumber.position : "-", doc.paras[pg.firstParaIndex]?.text.slice(0, 40));
