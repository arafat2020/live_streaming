import { Response } from 'express';

type TResponse<T> = {
  statusCode: number;
  success: boolean;
  message?: string;
  data: T;
  total?: number;
  page?: number;
  limit?: number;
};

const sendResponse = <T>(res: Response, data: TResponse<T>) => {
  res.status(data.statusCode).json({
    statusCode: data.statusCode,
    success: data.success,
    message: data.message,
    data: data.data,
    ...(data.total && { total: data.total }),
    ...(data.page && { page: data.page }),
    ...(data.limit && { limit: data.limit }),
  });
};

export default sendResponse;
