import { Request } from 'express';

export interface RequestWithUser extends Request {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    profileImage?: string;
  };
}
export interface GetMe extends Request {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    password: string;
    profileImage?: string;
    channel?:any
    
  };
}