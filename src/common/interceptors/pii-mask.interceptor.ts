import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { maskPii } from '../utils/pii-mask.util';

@Injectable()
export class PIIMaskInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => {
        // If the response has the standard shape from ResponseInterceptor
        if (data && data.success && data.data) {
          return {
            ...data,
            data: maskPii(data.data),
          };
        }
        // Otherwise mask the direct response
        return maskPii(data);
      }),
    );
  }
}
