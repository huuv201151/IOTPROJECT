import { Request, Response } from 'express';
import { aiService, ChatMessage } from '../services/ai.service';
import { env } from '../config/env';
import { chatRequestSchema, deviceIdSchema } from '../shared/ai-request';
import { cleanChatHistory } from '../shared/rainsense-ai';

const budgets = new Map<string, { count: number; resetAt: number }>();

export const aiController = {
  async chat(req: Request, res: Response) {
    try {
      const parsed = chatRequestSchema.safeParse({ ...req.body, deviceId: req.body?.deviceId ?? env.DEFAULT_STATION_ID });
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          error: 'Câu hỏi phải có 1–4000 ký tự và mã trạm hợp lệ'
        });
      }

      const key = req.ip || req.socket.remoteAddress || 'unknown';
      const now = Date.now();
      for (const [address, budget] of budgets) if (budget.resetAt <= now) budgets.delete(address);
      const budget = budgets.get(key) ?? { count: 0, resetAt: now + 60000 };
      if (budget.count >= 30) {
        res.setHeader('Retry-After', Math.ceil((budget.resetAt - now) / 1000));
        return res.status(429).json({ success: false, error: 'Bạn gửi nhiều câu hỏi liên tiếp. Vui lòng chờ một lát rồi thử lại.' });
      }
      budget.count++;
      budgets.set(key, budget);
      const { message, history, deviceId, rainMonitorDemo } = parsed.data;
      const result = await aiService.chat(
        message.trim(),
        cleanChatHistory(history) as ChatMessage[],
        deviceId,
        rainMonitorDemo
      );

      return res.json({
        success: true,
        data: result
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: 'Lỗi khi xử lý phản hồi từ RainSense AI'
      });
    }
  },

  async getContext(req: Request, res: Response) {
    try {
      const deviceId = (req.query.deviceId as string) || env.DEFAULT_STATION_ID;
      if (!deviceIdSchema.safeParse(deviceId).success) return res.status(400).json({ success: false, error: 'Mã trạm không hợp lệ' });
      const context = await aiService.getLiveContext(deviceId);
      return res.json({
        success: true,
        data: context
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: 'Lỗi khi lấy ngữ cảnh trạm cho RainSense AI'
      });
    }
  },

  async getSeries(req: Request, res: Response) {
    const deviceId = deviceIdSchema.safeParse(req.query.deviceId || env.DEFAULT_STATION_ID);
    const from = typeof req.query.from === 'string' ? new Date(req.query.from) : new Date(NaN);
    const to = typeof req.query.to === 'string' ? new Date(req.query.to) : new Date();
    if (!deviceId.success || !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from || to.getTime() - from.getTime() > 7 * 86400000 || to.getTime() > Date.now() + 60000) {
      return res.status(400).json({ success: false, error: 'Cần mã trạm và khoảng thời gian hợp lệ, tối đa 7 ngày, không ở tương lai' });
    }
    try {
      const data = await aiService.getMeasurementSeries(deviceId.data, from, to);
      return res.json({ success: true, data });
    } catch {
      return res.status(503).json({ success: false, error: 'Chưa đọc được chuỗi môi trường' });
    }
  }
};
