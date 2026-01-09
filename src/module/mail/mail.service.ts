import { Injectable,Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
//import SMTPTransport from 'nodemailer/lib/smtp-transport';
type SendMailOptions = {
  to: string;
  subject: string;
  html: string;
  from?: string;
};

@Injectable()
export class MailService {
  private transporter; // let TS infer the type
  private readonly logger = new Logger(MailService.name);
  // private transporter: nodemailer.Transporter<SMTPTransport.SentMessageInfo>;
  // private readonly logger = new Logger(MailService.name);
  constructor(private config: ConfigService) {

    this.transporter = nodemailer.createTransport({
      host: this.config.get('SMTP_HOST'),
      // port: Number(this.config.get('SMTP_PORT')),
      // secure: Number(this.config.get('SMTP_PORT')) === 465,
      port: 587, // or 587
      secure: false, // STARTTLS
      auth: {
        user: this.config.get('SMTP_USER'),
        pass: this.config.get('SMTP_PASS'),
      },
      pool: true,
      maxConnections: 5,
      connectionTimeout: 30000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
      tls: { rejectUnauthorized: false },
    });

  }

  async sendMail(options: SendMailOptions) {
    //console.log('Sending mail...',options);
    const { to, subject, html } = options;
    const data = await this.transporter.sendMail({
      from:process.env.SMTP_FROM,
      to,
      subject,
      html,
    });
    //console.log(data);
    this.logger.log(`Code sent to ${to} email.`);
  }

}
