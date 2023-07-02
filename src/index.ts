import {config} from "dotenv";
import {resolve} from "path";
import { ExtendedClient } from "./common/types";

const envFileName = process.env.NODE_ENV === "development" ? ".dev.env" : ".env";

config({path: resolve(process.cwd(), envFileName)});