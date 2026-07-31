'use client';

import FeaturesCards from '@/components/features-cards';
import FAQs from '@/components/faqs-component';
import { ResponseStream } from '@/components/ui/response-stream';
import { Header1 } from '@/components/header1';

export default function Home() {
  const platformIntroParagraphs = [
    '当几乎所有机构都在把自己包装成精致的都市丽人，穿西装在高档写字楼里谈"赋能""赛道"时，我们选择一头扎进泥土里。泥土里有被折叠的真实信息——那些机构不愿明说"这个岗位今年只招三人"的数据；那些被包装成"独家"其实公开可查的链接；那些用漂亮话掩盖的冰冷但有用的行业真相。泥土里也有被消费升级和求职焦虑抛弃的普通学生——他们不是不想花十几万块买安心，是花不起；不是不想被精心服务，是发现所谓精心服务最终只是为了把自己塞进更贵的链条。',
    '对于一个清醒意识到求职重要性的同学来说，能花极低的成本解决最直接的问题，就是最大的进步。',
    '我们管这叫"决策降级"——不是消费降级，是把选择权、评判权、止损权，一样一样还给你。以前做一个求职决策，先被销售教育两小时，再被合同困住半年，最后被维权消耗一个月。现在，你来决定值不值，你来决定要不要继续，你来决定什么时候转身就走。',
    '我们只负责一件事：把真正有用的工具，做到足够便宜、足够直接、足够没废话。',
  ];

  return (
    <div className="min-h-screen bg-white dark:bg-black">
      <Header1 />
      <div className="pt-20">
        <FeaturesCards />
        
        {/* Platform Introduction with Typewriter Effect */}
        <section className="py-16 px-4 bg-white dark:bg-black">
          <div className="max-w-6xl mx-auto text-left space-y-6">
            {platformIntroParagraphs.map((paragraph, index) => (
              <ResponseStream
                key={index}
                textStream={paragraph}
                mode="typewriter"
                speed={30}
                className="text-lg md:text-xl text-gray-700 dark:text-gray-300 leading-relaxed"
              />
            ))}
          </div>
        </section>

        <FAQs />
      </div>
    </div>
  );
}
