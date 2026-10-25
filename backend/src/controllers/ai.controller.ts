import { Request, Response } from 'express';
import { aiService, ChatMessage } from '../services/ai.service';
import { env } from '../config/env';

export const aiController = {
  async chat(req: Request, res: Response) {
    try {
      const { message, history = [], deviceId = env.DEFAULT_STATION_ID } = req.body;

      if (!message || typeof message !== 'string' || message.trim() === '') {
        return res.status(400).json({
          success: false,
          error: 'Vui lòng cung cấp nội dung câu hỏi cho RainSense AI'
        });
      }

      const result = await aiService.chat(
        message.trim(),
        history as ChatMessage[],
        deviceId
      );

      return res.json({
        success: true,
        data: result
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message || 'Lỗi khi xử lý phản hồi từ RainSense AI'
      });
    }
  },

  async getContext(req: Request, res: Response) {
    try {
      const deviceId = (req.query.deviceId as string) || env.DEFAULT_STATION_ID;
      const context = await aiService.getLiveContext(deviceId);
      return res.json({
        success: true,
        data: context
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message || 'Lỗi khi lấy ngữ cảnh trạm cho RainSense AI'
      });
    }
  },

  async getConfig(req: Request, res: Response) {
    try {
      const config = aiService.getConfig();
      return res.json({
        success: true,
        data: config
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message || 'Lỗi khi đọc cấu hình AI'
      });
    }
  },

  async updateConfig(req: Request, res: Response) {
    try {
      const { apiKey, model } = req.body;
      const config = aiService.updateConfig(apiKey, model);
      return res.json({
        success: true,
        data: config,
        message: 'Đã cập nhật cấu hình Google AI Studio thành công!'
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message || 'Lỗi khi lưu cấu hình AI'
      });
    }
  },

  async testKey(req: Request, res: Response) {
    try {
      const { apiKey, model } = req.body;
      const result = await aiService.testGeminiKey(apiKey, model);
      return res.json({
        success: true,
        data: result
      });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        error: error.message || 'Kiểm tra API Key thất bại'
      });
    }
  }
};
