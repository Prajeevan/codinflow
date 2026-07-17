import type { NextFunction, Request, Response } from "express";
import { findUserByToken } from "./db.js";

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.header("authorization")?.replace("Bearer ", "");

  if (!token) {
    res.status(401).json({ error: "missing token" });
    return;
  }

  const user = await findUserByToken(token);

  if (!user) {
    res.status(401).json({ error: "invalid token" });
    return;
  }

  next();
}
