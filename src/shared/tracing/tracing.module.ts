import {
  Global,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { shutdownTracing } from './tracing-shutdown.js';

@Injectable()
class TracingShutdown implements OnApplicationShutdown {
  onApplicationShutdown(): Promise<void> {
    return shutdownTracing();
  }
}

@Global()
@Module({ providers: [TracingShutdown] })
export class TracingModule {}
