import { Quote } from "lucide-react";
import { REVIEWS, REVIEWS_DISCLAIMER } from "@/content/reviews";

export function ReviewsSection() {
  if (REVIEWS.length === 0) return null;

  return (
    <section id="reviews" className="section-pad border-y border-ink/8 bg-cream-deep/35">
      <div className="container-page">
        <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-7">
            <div className="flex flex-wrap items-center gap-2">
              <span className="eyebrow reveal">Отзывы</span>
              <span className="badge-demo">демонстрационные</span>
            </div>
            <h2 className="display reveal mt-5 text-[clamp(2.5rem,4.4vw,4.1rem)]">
              Без выдуманных
              <br />
              <span className="text-ink/45">имён и оценок.</span>
            </h2>
          </div>
          <div className="lg:col-span-4 lg:col-start-9">
            <p className="body-copy reveal">
              Раздел отзывов управляется данными. Реальные истории появятся
              после согласования с клиентами; сейчас здесь только размеченные
              демо-карточки.
            </p>
          </div>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {REVIEWS.map((review, index) => (
            <figure
              key={review.id}
              className="card-hover reveal card-surface relative flex min-h-[19rem] flex-col justify-between p-6"
              style={{ transitionDelay: `${index * 55}ms` }}
            >
              <div>
                <div className="flex items-start justify-between">
                  <Quote size={28} className="text-copper/30" strokeWidth={1.2} />
                  <span className="badge-demo">demo</span>
                </div>
                <blockquote className="mt-6 text-[0.92rem] leading-relaxed text-ink/68">
                  {review.text}
                </blockquote>
              </div>
              <figcaption className="mt-7 border-t border-ink/8 pt-4">
                <div className="text-[0.82rem] font-semibold">{review.name}</div>
                <div className="mt-0.5 text-[0.66rem] text-ink/42">
                  {review.project}
                </div>
              </figcaption>
            </figure>
          ))}
        </div>

        <p className="reveal mt-6 text-[0.68rem] leading-relaxed text-ink/38">
          {REVIEWS_DISCLAIMER}
        </p>
      </div>
    </section>
  );
}
