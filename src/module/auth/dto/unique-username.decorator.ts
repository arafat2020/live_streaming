import {
    registerDecorator,
    ValidationArguments,
    ValidationOptions,
    ValidatorConstraint,
    ValidatorConstraintInterface,
} from 'class-validator';
import { PrismaService } from '../../../prisma/prisma.service';

@ValidatorConstraint({ async: true, name: 'isUsernameUnique' })
export class IsUsernameUniqueConstraint implements ValidatorConstraintInterface {
    private prisma: PrismaService;

    constructor() {
        this.prisma = new PrismaService();
    }

    async validate(username: string) {
        if (!username) return false;

        try {
            const existingUser = await this.prisma.user.findUnique({
                where: { username },
            });

            return !existingUser;
        } catch {
            return false;
        }
    }

    defaultMessage(args: ValidationArguments) {
        return `Username '${args.value}' is already taken.`;
    }
}

export function IsUsernameUnique(validationOptions?: ValidationOptions) {
    return function (object: object, propertyName: string) {
        registerDecorator({
            target: object.constructor,
            propertyName: propertyName,
            options: validationOptions,
            constraints: [],
            validator: IsUsernameUniqueConstraint,
        });
    };
}
